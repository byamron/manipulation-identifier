import express from 'express';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import cors from 'cors';
import { promptRoleSystem, promptRoleUser } from './prompts.js';

dotenv.config();

// Configuration
const CONFIG = {
  PORT: process.env.PORT || 3000,
  CACHE_DURATION: 1000 * 60 * 60, // 1 hour
  RATE_LIMIT: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  },
  MAX_CONTENT_LENGTH: 5000 // characters
};

// Simple in-memory cache
const cache = new Map();

// Utility to clean old cache entries
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

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

app.post('/analyze-content', validateContent, async (req, res) => {
  const { content } = req.body;
  const cacheKey = content.trim();

  try {
    // Check cache
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (Date.now() - cached.timestamp < CONFIG.CACHE_DURATION) {
        console.log('Cache hit');
        return res.json(cached.data);
      }
      cache.delete(cacheKey);
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: promptRoleSystem },
        { role: 'user', content: promptRoleUser + content }
      ],
      max_tokens: 1000,
      temperature: 0.3,
    });

    if (!response?.choices?.[0]?.message?.content) {
      throw new Error('Invalid response from OpenAI');
    }

    const manipulativeLanguage = response.choices[0].message.content;
    
    // Check if no manipulation was detected
    if (manipulativeLanguage.trim() === "No manipulation tactics detected.") {
      const result = {
        manipulativeLanguage,
        results: []
      };
      cache.set(cacheKey, {
        timestamp: Date.now(),
        data: result
      });
      return res.json(result);
    }

    // Parse the response to extract tactics
    const tactics = [];
    const sections = manipulativeLanguage.split(/\[(.*?)\]/);
    
    for (let i = 1; i < sections.length; i += 2) {
      const tacticName = sections[i].trim();
      const content = sections[i + 1] || '';
      
      // Extract definition
      const definitionMatch = content.match(/Definition:\s*([^\n]+)/);
      const definition = definitionMatch ? definitionMatch[1].trim() : '';
      
      // Extract examples and explanations
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

    const result = { 
      manipulativeLanguage,
      results: tactics
    };

    // Cache the result
    cache.set(cacheKey, {
      timestamp: Date.now(),
      data: result
    });

    console.log('Sending analysis result:', result);
    res.json(result);
  } catch (error) {
    console.error('Error analyzing content:', error);

    const errorResponse = {
      error: 'Failed to analyze content',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    };

    if (error.code === 'insufficient_quota') {
      res.status(402).json({ ...errorResponse, error: 'OpenAI API quota exceeded' });
    } else if (error.code === 'invalid_api_key') {
      res.status(401).json({ ...errorResponse, error: 'Invalid OpenAI API key' });
    } else if (error.code === 'context_length_exceeded') {
      res.status(400).json({ ...errorResponse, error: 'Content too long for analysis' });
    } else {
      res.status(500).json(errorResponse);
    }
  }
});

// Health check endpoint with basic metrics
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: Date.now(),
    cacheSize: cache.size,
    port: CONFIG.PORT
  });
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
  console.log(`Server is running on port ${CONFIG.PORT}`);
  console.log(`Health check: http://localhost:${CONFIG.PORT}/health`);
});