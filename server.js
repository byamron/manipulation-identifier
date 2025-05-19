import express from 'express';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import cors from 'cors';
import { promptRoleSystem } from './prompts.js';  // Ensure this path is correct

dotenv.config();

// Initialize OpenAI client with the API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS for extension requests
app.use(cors({
  origin: ['chrome-extension://*', 'http://localhost:*'],
  credentials: true
}));

app.use(express.json());

app.post('/analyze-content', async (req, res) => {
  const content = req.body.content;

  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'No content provided for analysis' });
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4', // Fixed model name - use 'gpt-4' or 'gpt-3.5-turbo'
      messages: [
        { role: 'system', content: promptRoleSystem },
        { role: 'user', content: `Please analyze the following text for manipulation tactics: ${content}` },
      ],
      max_tokens: 1000,
      temperature: 0.3,
    });

    const manipulativeLanguage = response.choices[0].message.content;
    
    res.json({ manipulativeLanguage });
  } catch (error) {
    console.error('Error analyzing content:', error);
    
    // More specific error handling
    if (error.code === 'insufficient_quota') {
      res.status(402).json({ error: 'OpenAI API quota exceeded' });
    } else if (error.code === 'invalid_api_key') {
      res.status(401).json({ error: 'Invalid OpenAI API key' });
    } else {
      res.status(500).json({ error: 'Failed to analyze content' });
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'Server is running', port });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
});