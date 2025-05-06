import express from 'express';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';

dotenv.config();
const app = express();
const port = 3000;

// Middleware to parse JSON
app.use(express.json());

// Initialize OpenAI client with the API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// POST route to process the page content and analyze it with the LLM
app.post('/analyze', async (req, res) => {
  const { text } = req.body;  // This is the text received from the frontend

  if (!text) {
    return res.status(400).json({ error: 'Text content is required' });
  }

  try {
    // Send the text to OpenAI for analysis
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: 'You are an assistant trained to identify emotional manipulation tactics in text.' },
        { role: 'user', content: `Please identify any emotional manipulation tactics (e.g., guilt-tripping, gaslighting) in the following text: ${text}` },
      ],
    });

    // Send back the LLM response to the frontend
    res.json({ manipulationTactics: response.choices[0].message.content });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
