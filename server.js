import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import cors from 'cors';
import { promptRoleSystem, buildUserPrompt } from './prompts.js';
import { dbOperations } from './database.js';
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
    'claude-sonnet-4-6': { tokens: 4096, name: 'claude-sonnet-4-6' },
    'claude-haiku-4-5-20251001': { tokens: 4096, name: 'claude-haiku-4-5-20251001' }
  }
};

// Simple in-memory cache
const cache = new Map();

// Utility functions
function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

function calculateComplexityScore(text, tacticsCount) {
  // Simple complexity score based on text length and tactics found
  const textComplexity = Math.min(text.length / 1000, 5); // Max 5 points for text length
  const tacticComplexity = tacticsCount * 2; // 2 points per tactic
  return textComplexity + tacticComplexity;
}

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

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 30000,
});

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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
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

// Parse JSON response (handles markdown fences from Anthropic)
function parseJsonResponse(rawContent) {
  try {
    const cleaned = rawContent.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    const detected = parsed.tactics_detected;

    if (!Array.isArray(detected)) return [];

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
async function analyzeContent(content, model, sessionId, pageUrl, res) {
  const modelConfig = CONFIG.MODELS[model];
  const cacheKey = `${model}:${content.trim()}`;
  const startTime = Date.now();

  try {
    // Check cache
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (Date.now() - cached.timestamp < CONFIG.CACHE_DURATION) {
        await dbOperations.recordPerformance({
          model_name: model,
          response_time_ms: Date.now() - startTime,
          success: true,
          error_message: null,
          tokens_used: cached.data.tokensUsed || 0,
          tactics_detected_count: cached.data.results.length,
          analysis_complexity_score: calculateComplexityScore(content, cached.data.results.length),
          session_id: sessionId,
          page_url: pageUrl
        });

        return res.json({
          ...cached.data,
          model: model,
          sessionId: sessionId
        });
      }
      cache.delete(cacheKey);
    }

    const response = await anthropic.messages.create({
      model: modelConfig.name,
      max_tokens: modelConfig.tokens,
      system: promptRoleSystem,
      messages: [
        { role: 'user', content: buildUserPrompt(content) }
      ]
    });

    const responseContent = response?.content?.[0]?.text;
    if (!responseContent) {
      throw new Error('No response from Anthropic');
    }

    const responseTime = Date.now() - startTime;
    const manipulativeLanguage = responseContent;

    // Try JSON structured output first, fall back to regex parser
    let tactics = parseJsonResponse(manipulativeLanguage);
    if (tactics === null) {
      tactics = parseAnalysisResponse(manipulativeLanguage);
    }
    const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

    const result = {
      manipulativeLanguage,
      results: tactics,
      model: model,
      sessionId: sessionId,
      tokensUsed: tokensUsed,
      responseTime: responseTime
    };

    // Cache the result
    cache.set(cacheKey, {
      timestamp: Date.now(),
      data: {
        manipulativeLanguage,
        results: tactics,
        tokensUsed: tokensUsed
      }
    });

    await dbOperations.recordPerformance({
      model_name: model,
      response_time_ms: responseTime,
      success: true,
      error_message: null,
      tokens_used: tokensUsed,
      tactics_detected_count: tactics.length,
      analysis_complexity_score: calculateComplexityScore(content, tactics.length),
      session_id: sessionId,
      page_url: pageUrl
    });

    res.json(result);

  } catch (error) {
    console.error(`Error analyzing content with ${model}:`, error);
    const responseTime = Date.now() - startTime;

    await dbOperations.recordPerformance({
      model_name: model,
      response_time_ms: responseTime,
      success: false,
      error_message: error.message,
      tokens_used: 0,
      tactics_detected_count: 0,
      analysis_complexity_score: 0,
      session_id: sessionId,
      page_url: pageUrl
    });

    const errorResponse = {
      error: 'Failed to analyze content',
      model: model,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    };

    const status = error.status || error.statusCode;
    if (status === 401) {
      res.status(401).json({ ...errorResponse, error: 'Invalid Anthropic API key' });
    } else if (status === 402 || status === 429) {
      res.status(status).json({ ...errorResponse, error: 'Anthropic API quota exceeded or rate limited' });
    } else if (status === 400) {
      res.status(400).json({ ...errorResponse, error: 'Content too long for analysis' });
    } else {
      res.status(500).json(errorResponse);
    }
  }
}

// ENHANCED ANALYZE ENDPOINT WITH MODEL SELECTION
app.post('/analyze-content-with-model', rateLimit, validateContent, validateModel, async (req, res) => {
  const { content, model, sessionId = generateSessionId(), pageUrl = '' } = req.body;
  await analyzeContent(content, model, sessionId, pageUrl, res);
});

// FEEDBACK SUBMISSION ENDPOINT
app.post('/submit-instance-feedback', async (req, res) => {
  try {
    const {
      originalFullText,
      highlightedText,
      detectedTactic,
      modelUsed,
      userRating,
      userComments,
      pageUrl,
      responseTime,
      sessionId
    } = req.body;

    // Validate required fields
    if (!originalFullText || !highlightedText || !detectedTactic || !modelUsed || !userRating) {
      return res.status(400).json({ 
        error: 'Missing required fields: originalFullText, highlightedText, detectedTactic, modelUsed, userRating' 
      });
    }

    // Validate rating
    if (!['accurate', 'inaccurate', 'uncertain'].includes(userRating)) {
      return res.status(400).json({ 
        error: 'userRating must be one of: accurate, inaccurate, uncertain' 
      });
    }

    const feedbackId = await dbOperations.recordFeedback({
      page_url: pageUrl,
      original_full_text: originalFullText,
      highlighted_text: highlightedText,
      model_used: modelUsed,
      detected_tactic: detectedTactic,
      user_rating: userRating,
      user_comments: userComments,
      response_time_ms: responseTime,
      session_id: sessionId,
      feedback_type: 'detection_feedback'
    });

    res.json({ 
      success: true, 
      feedbackId: feedbackId,
      message: 'Feedback recorded successfully' 
    });

  } catch (error) {
    console.error('Error recording feedback:', error);
    res.status(500).json({ 
      error: 'Failed to record feedback',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
});

// MISSING MANIPULATION REPORT ENDPOINT
app.post('/report-missing-manipulation', async (req, res) => {
  try {
    const {
      originalFullText,
      missedText,
      suggestedTactic,
      userComments,
      modelUsed,
      pageUrl,
      sessionId,
      reportedFromFeedbackId
    } = req.body;

    // Validate required fields
    if (!originalFullText || !missedText || !suggestedTactic || !modelUsed) {
      return res.status(400).json({ 
        error: 'Missing required fields: originalFullText, missedText, suggestedTactic, modelUsed' 
      });
    }

    const reportId = await dbOperations.recordMissingManipulation({
      page_url: pageUrl,
      original_full_text: originalFullText,
      missed_text: missedText,
      suggested_tactic: suggestedTactic,
      user_comments: userComments,
      model_used: modelUsed,
      session_id: sessionId,
      reported_from_feedback_id: reportedFromFeedbackId
    });

    res.json({
      success: true,
      reportId: reportId,
      message: 'Missing manipulation report recorded successfully' 
    });

  } catch (error) {
    console.error('Error recording missing manipulation report:', error);
    res.status(500).json({ 
      error: 'Failed to record missing manipulation report',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
});

// ANALYTICS ENDPOINTS

// Get model performance analytics
app.get('/analytics/model-performance', async (req, res) => {
  try {
    const analytics = await dbOperations.getModelAnalytics();
    res.json(analytics);
  } catch (error) {
    console.error('Error fetching model analytics:', error);
    res.status(500).json({ error: 'Failed to fetch model analytics' });
  }
});

// Get user satisfaction by model
app.get('/analytics/satisfaction', async (req, res) => {
  try {
    const satisfaction = await dbOperations.getSatisfactionByModel();
    res.json(satisfaction);
  } catch (error) {
    console.error('Error fetching satisfaction data:', error);
    res.status(500).json({ error: 'Failed to fetch satisfaction data' });
  }
});

// Get tactic performance
app.get('/analytics/tactic-performance/:model', async (req, res) => {
  try {
    const { model } = req.params;
    const performance = await dbOperations.getTacticPerformance(model);
    res.json(performance);
  } catch (error) {
    console.error('Error fetching tactic performance:', error);
    res.status(500).json({ error: 'Failed to fetch tactic performance' });
  }
});

// Get tactic performance for all models
app.get('/analytics/tactic-performance', async (req, res) => {
  try {
    const performance = await dbOperations.getTacticPerformance();
    res.json(performance);
  } catch (error) {
    console.error('Error fetching tactic performance:', error);
    res.status(500).json({ error: 'Failed to fetch tactic performance' });
  }
});

// Get missing manipulation patterns
app.get('/analytics/missing-patterns', async (req, res) => {
  try {
    const patterns = await dbOperations.getMissingPatterns();
    res.json(patterns);
  } catch (error) {
    console.error('Error fetching missing patterns:', error);
    res.status(500).json({ error: 'Failed to fetch missing patterns' });
  }
});

// Get recent performance data
app.get('/analytics/recent-performance/:hours', async (req, res) => {
  try {
    const hours = parseInt(req.params.hours) || 24;
    const performance = await dbOperations.getRecentPerformance(hours);
    res.json(performance);
  } catch (error) {
    console.error('Error fetching recent performance:', error);
    res.status(500).json({ error: 'Failed to fetch recent performance' });
  }
});

// Get recent performance data (default 24 hours)
app.get('/analytics/recent-performance', async (req, res) => {
  try {
    const performance = await dbOperations.getRecentPerformance(24);
    res.json(performance);
  } catch (error) {
    console.error('Error fetching recent performance:', error);
    res.status(500).json({ error: 'Failed to fetch recent performance' });
  }
});

// BACKWARD COMPATIBILITY - Keep original endpoint (defaults to claude-sonnet-4-6)
app.post('/analyze-content', rateLimit, validateContent, async (req, res) => {
  const { content, sessionId = generateSessionId(), pageUrl = '' } = req.body;
  await analyzeContent(content, 'claude-sonnet-4-6', sessionId, pageUrl, res);
});

// Health check endpoint with enhanced metrics
app.get('/health', async (req, res) => {
  try {
    const recentPerformance = await dbOperations.getRecentPerformance(1); // Last hour
    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: Date.now(),
      cacheSize: cache.size,
      port: CONFIG.PORT,
      availableModels: Object.keys(CONFIG.MODELS),
      recentAnalyses: recentPerformance.length
    });
  } catch (error) {
    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: Date.now(),
      cacheSize: cache.size,
      port: CONFIG.PORT,
      availableModels: Object.keys(CONFIG.MODELS),
      recentAnalyses: 'unknown'
    });
  }
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