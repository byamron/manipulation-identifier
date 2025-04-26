import { OpenAI } from 'openai';
import dotenv from 'dotenv';

// Import the prompts from prompts.js
import { promptRoleSystem, promptRoleUser } from './prompts.js'; // Adjust the path if needed

// Load environment variables from the .env file
dotenv.config();

// Initialize OpenAI client with the API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function testOpenAI() {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: promptRoleSystem },
        { role: 'user', content: promptRoleUser },
      ],
    });

    // Assuming the response structure is as follows (adjusted for OpenAI library):
    console.log(response.choices[0].message.content); // Log the model's response
  } catch (error) {
    console.error('Error:', error); // Log any errors that occur
  }
}

testOpenAI();