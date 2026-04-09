import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import cors from 'cors';
import { promptRoleSystem, buildUserPrompt } from './prompts.js';
import crypto from 'crypto';

dotenv.config();

// Configuration
const CONFIG = {
  PORT: process.env.PORT || 3000,
  CACHE_DURATION: 1000 * 60 * 60, // 1 hour
  RATE_LIMIT: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  },
  MAX_CONTENT_LENGTH: 5000, // characters
  MODELS: {
    'gemini-2.5-flash': { tokens: 4096, name: 'gemini-2.5-flash' },
    'gemini-2.5-flash-lite': { tokens: 4096, name: 'gemini-2.5-flash-lite' }
  }
};

// Simple in-memory cache
const cache = new Map();

function cleanCache() {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CONFIG.CACHE_DURATION) {
      cache.delete(key);
    }
  }
}

// Clean cache periodically
setInterval(cleanCache, CONFIG.CACHE_DURATION);

// Initialize Google Generative AI client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// In-memory rate limiter
const rateLimitStore = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowStart = now - CONFIG.RATE_LIMIT.windowMs;

  let entry = rateLimitStore.get(ip);
  if (!entry) {
    entry = { requests: [], blocked: false };
    rateLimitStore.set(ip, entry);
  }

  // Remove old entries
  entry.requests = entry.requests.filter(t => t > windowStart);
  entry.requests.push(now);

  if (entry.requests.length > CONFIG.RATE_LIMIT.max) {
    const retryAfter = Math.ceil((entry.requests[0] - windowStart) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'Too many requests. Try again later.',
      retryAfter
    });
  }

  next();
}

// Clean up rate limit store periodically
setInterval(() => {
  const cutoff = Date.now() - CONFIG.RATE_LIMIT.windowMs;
  for (const [ip, entry] of rateLimitStore.entries()) {
    entry.requests = entry.requests.filter(t => t > cutoff);
    if (entry.requests.length === 0) rateLimitStore.delete(ip);
  }
}, CONFIG.RATE_LIMIT.windowMs);

const app = express();

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.url} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// Allow all origins for local development
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Content validation middleware
function validateContent(req, res, next) {
  const { content } = req.body;

  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Content must be a non-empty string' });
  }

  if (content.trim().length === 0) {
    return res.status(400).json({ error: 'Content cannot be empty' });
  }

  if (content.length > CONFIG.MAX_CONTENT_LENGTH) {
    return res.status(400).json({ 
      error: `Content exceeds maximum length of ${CONFIG.MAX_CONTENT_LENGTH} characters` 
    });
  }

  next();
}

// Model validation middleware
function validateModel(req, res, next) {
  const { model } = req.body;
  
  if (!model || !CONFIG.MODELS[model]) {
    return res.status(400).json({ 
      error: 'Invalid model. Must be one of: ' + Object.keys(CONFIG.MODELS).join(', ')
    });
  }

  next();
}

// Parse JSON response (handles markdown fences from LLM)
function parseJsonResponse(rawContent) {
  try {
    const cleaned = rawContent.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    const detected = parsed.tactics_detected;

    if (!Array.isArray(detected)) return null;

    return detected
      .filter(t => t.tactic_name && t.definition && Array.isArray(t.instances) && t.instances.length > 0)
      .map(t => ({
        tactic: t.tactic_name,
        definition: t.definition,
        examples: t.instances.map(inst => ({
          text: inst.exact_quote,
          explanation: inst.explanation
        }))
      }));
  } catch {
    return null; // Signal to fall back to regex parser
  }
}

// Legacy regex parser — fallback for models without structured output
function parseAnalysisResponse(manipulativeLanguage) {
  if (manipulativeLanguage.trim() === "No manipulation tactics detected.") {
    return [];
  }

  const tactics = [];
  const sections = manipulativeLanguage.split(/\[(.*?)\]/);

  for (let i = 1; i < sections.length; i += 2) {
    const tacticName = sections[i].trim();
    const content = sections[i + 1] || '';

    const definitionMatch = content.match(/Definition:\s*([^\n]+)/);
    const definition = definitionMatch ? definitionMatch[1].trim() : '';

    const examples = [];
    const exampleMatches = content.matchAll(/(\d+)\.\s*"([^"]+)"\s*Why this is an example:\s*([^\n]+)/g);

    for (const match of exampleMatches) {
      examples.push({
        text: match[2].trim(),
        explanation: match[3].trim()
      });
    }

    if (tacticName && definition && examples.length > 0) {
      tactics.push({
        tactic: tacticName,
        definition: definition,
        examples: examples
      });
    }
  }

  return tactics;
}

// Core analysis logic shared by both endpoints
async function analyzeContent(content, model, res) {
  const modelConfig = CONFIG.MODELS[model];
  const cacheKey = crypto.createHash('sha256').update(`${model}:${content.trim()}`).digest('hex');
  const startTime = Date.now();

  try {
    // Check cache
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (Date.now() - cached.timestamp < CONFIG.CACHE_DURATION) {
        return res.json({ ...cached.data, model });
      }
      cache.delete(cacheKey);
    }

    const geminiModel = genAI.getGenerativeModel({
      model: modelConfig.name,
      systemInstruction: promptRoleSystem,
      generationConfig: { maxOutputTokens: modelConfig.tokens }
    });

    const response = await geminiModel.generateContent(buildUserPrompt(content));

    const responseContent = response.response?.text();
    if (!responseContent) {
      throw new Error('No response from Gemini');
    }

    const responseTime = Date.now() - startTime;

    // Try JSON structured output first, fall back to regex parser
    let tactics = parseJsonResponse(responseContent);
    if (tactics === null) {
      tactics = parseAnalysisResponse(responseContent);
    }
    const usage = response.response?.usageMetadata;
    const tokensUsed = (usage?.promptTokenCount || 0) + (usage?.candidatesTokenCount || 0);

    const result = {
      manipulativeLanguage: responseContent,
      results: tactics,
      model,
      tokensUsed,
      responseTime
    };

    // Cache the result
    cache.set(cacheKey, {
      timestamp: Date.now(),
      data: {
        manipulativeLanguage: responseContent,
        results: tactics,
        tokensUsed
      }
    });

    res.json(result);

  } catch (error) {
    console.error(`Error analyzing content with ${model}:`, error);

    const errorResponse = {
      error: 'Failed to analyze content',
      model: model,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    };

    const status = error.status || error.statusCode;
    if (status === 401 || status === 403) {
      res.status(401).json({ ...errorResponse, error: 'Invalid API key.' });
    } else if (status === 429) {
      res.status(429).json({ ...errorResponse, error: 'Rate limited. Try again in a minute.' });
    } else if (status === 400) {
      res.status(400).json({ ...errorResponse, error: 'Content too long for analysis' });
    } else {
      res.status(500).json(errorResponse);
    }
  }
}

// ENHANCED ANALYZE ENDPOINT WITH MODEL SELECTION
app.post('/analyze-content-with-model', rateLimit, validateContent, validateModel, async (req, res) => {
  const { content, model } = req.body;
  await analyzeContent(content, model, res);
});

// BACKWARD COMPATIBILITY - Keep original endpoint (defaults to gemini-2.5-flash)
app.post('/analyze-content', rateLimit, validateContent, async (req, res) => {
  const { content } = req.body;
  await analyzeContent(content, 'gemini-2.5-flash', res);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: Date.now(),
    cacheSize: cache.size,
    port: CONFIG.PORT,
    availableModels: Object.keys(CONFIG.MODELS)
  });
});

// Error handling middleware (must be after all routes)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

const server = app.listen(CONFIG.PORT, () => {
  console.log(`Enhanced server is running on port ${CONFIG.PORT}`);
  console.log(`Health check: http://localhost:${CONFIG.PORT}/health`);
  console.log(`Available models: ${Object.keys(CONFIG.MODELS).join(', ')}`);
});

export { parseAnalysisResponse, parseJsonResponse };
export default app;