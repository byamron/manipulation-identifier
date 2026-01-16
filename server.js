import express from 'express';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import cors from 'cors';
import { promptRoleSystem, promptRoleUser } from './prompts.js';
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
    'gpt-5': { tokens: 4000, name: 'gpt-5' },
    'gpt-5-mini': { tokens: 4000, name: 'gpt-5-mini' },
    'gpt-5-nano': { tokens: 4000, name: 'gpt-5-nano' }
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

// Parse analysis response
function parseAnalysisResponse(manipulativeLanguage) {
  if (manipulativeLanguage.trim() === "No manipulation tactics detected.") {
    return [];
  }

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

  return tactics;
}

// ENHANCED ANALYZE ENDPOINT WITH MODEL SELECTION
app.post('/analyze-content-with-model', validateContent, validateModel, async (req, res) => {
  const { content, model, sessionId = generateSessionId(), pageUrl = '' } = req.body;
  const modelConfig = CONFIG.MODELS[model];
  const cacheKey = `${model}:${content.trim()}`;
  const startTime = Date.now();

  try {
    // Check cache
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (Date.now() - cached.timestamp < CONFIG.CACHE_DURATION) {
        console.log('Cache hit for model:', model);
        
        // Record performance from cache
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

    const response = await openai.chat.completions.create({
      model: modelConfig.name,
      messages: [
        { role: 'system', content: promptRoleSystem },
        { role: 'user', content: promptRoleUser + content }
      ],
      max_completion_tokens: modelConfig.tokens,
    });

    if (!response?.choices?.[0]?.message?.content) {
      throw new Error('Invalid response from OpenAI');
    }

    const responseTime = Date.now() - startTime;
    const manipulativeLanguage = response.choices[0].message.content;
    const tactics = parseAnalysisResponse(manipulativeLanguage);
    const tokensUsed = response.usage?.total_tokens || 0;
    
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

    // Record performance
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

    console.log(`Analysis completed with ${model}:`, { tactics: tactics.length, responseTime, tokensUsed });
    res.json(result);

  } catch (error) {
    console.error(`Error analyzing content with ${model}:`, error);
    const responseTime = Date.now() - startTime;

    // Record failed performance
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

    console.log(`Feedback recorded for ${modelUsed}:`, { 
      tactic: detectedTactic, 
      rating: userRating, 
      feedbackId 
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

    console.log(`Missing manipulation reported for ${modelUsed}:`, { 
      tactic: suggestedTactic, 
      reportId 
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

// BACKWARD COMPATIBILITY - Keep original endpoint
app.post('/analyze-content', validateContent, async (req, res) => {
  // Default to gpt-5-nano for backward compatibility
  req.body.model = 'gpt-5-nano';
  return app._router.handle(req, res, () => {});
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

export default app;