import express from 'express';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import { promptRoleSystem } from './prompts.js';  // Ensure this path is correct

dotenv.config();

// Initialize OpenAI client with the API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.post('/analyze-content', async (req, res) => {
  const content = req.body.content;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1', // Ensure you use the model you're testing with
      messages: [
        { role: 'system', content: promptRoleSystem },
        { role: 'user', content: content },  // Send user content for analysis
      ],
    });

    const manipulativeLanguage = response.choices[0].message.content;
    
    res.json({ manipulativeLanguage });
  } catch (error) {
    console.error('Error analyzing content:', error);
    res.status(500).json({ error: 'Failed to analyze content' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
