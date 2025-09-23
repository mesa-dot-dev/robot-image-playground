# 🤖 Robot Image Generator

Generate unique robot avatars for programming languages and concepts using AI image generation models.

## Features

- **Dual Model Support**: Choose between OpenAI GPT-4o and Google Gemini 2.5 Flash Image (Nano Banana)
- **Smart Research**: Both models research the concept before generating to ensure accurate representation
- **Reference-Based Generation**: Uses existing robot designs as style references for consistency
- **Intelligent Caching**: Reuses existing images to avoid unnecessary API costs
- **Cost Tracking**: Real-time cost tracking for both models with session summaries
- **Gallery View**: Browse all generated robots in a visual gallery
- **Model Testing**: Built-in test functionality to verify API connectivity

## Models Comparison

| Feature | OpenAI GPT-4o | Google Gemini 2.5 Flash Image |
|---------|---------------|-------------------------------|
| **Cost per Image** | ~$0.1664 | ~$0.0387 (4.3x cheaper!) |
| **Quality** | High quality, detailed | High quality, fast generation |
| **Speed** | Moderate | Fast |
| **Best For** | Complex designs, high fidelity | Rapid prototyping, cost efficiency |

## Pricing Details

### Google Gemini 2.5 Flash Image (Nano Banana)
- **$30.00 per 1 million output tokens**
- Each image uses 1,290 output tokens
- **Cost per image: $0.0387**

### OpenAI GPT-4o with Image Generation
- Input: $10.00 per 1M tokens
- Output: $40.00 per 1M tokens
- Image generation: ~4,160 tokens
- **Cost per image: ~$0.1664**

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd "Robot Image Playground"
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Open your browser and navigate to:
```
http://localhost:3000
```

## Usage

### Generating Images

1. **Select a Model**: Use the dropdown at the top to choose between OpenAI and Google Gemini
2. **Enter a Prompt**: Type a programming language or concept (e.g., "Python", "Security", "React Native")
3. **Click Generate**: The system will:
   - Research the concept to understand its visual identity
   - Analyze reference images for consistent style
   - Generate a unique robot avatar
   - Display cost information

### Testing Models

Click the "Test Model" button to verify that your selected model is working correctly. This will:
- Test text generation capabilities
- Test image generation capabilities
- Report the test cost

### Cost Tracking

The session cost summary shows:
- Number of API calls per model
- Total cost per model
- Combined total cost

Cached images (reused from previous generations) incur no additional cost.

## API Endpoints

### POST /api/generate
Generate a robot image.

**Request:**
```json
{
  "prompt": "Python",
  "model": "openai" | "google"
}
```

**Response:**
```json
{
  "success": true,
  "filename": "python_1234567890.png",
  "research": "Research results...",
  "tokenUsage": { ... },
  "cost": "$0.0387",
  "cached": false
}
```

### POST /api/test-model
Test model connectivity and functionality.

**Request:**
```json
{
  "model": "openai" | "google"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Model is working!",
  "cost": "$0.0001"
}
```

### GET /api/gallery
Get list of all generated images.

**Response:**
```json
[
  {
    "filename": "python_1234567890.png",
    "name": "python"
  }
]
```

## Architecture

### Shared Prompt System
Both models use the same prompt generation system:
1. **Research Phase**: Understands the concept's visual identity, colors, and characteristics
2. **Style Analysis**: Analyzes reference images to maintain consistent robot style
3. **Prompt Building**: Creates detailed generation instructions
4. **Generation**: Model-specific image generation

### Intelligent Reference System
- Finds related robots from existing library
- Uses them as primary references for consistency
- Maintains visual identity across variations

## File Structure

```
Robot Image Playground/
├── index.html           # Web interface
├── server.js           # Express server with dual model support
├── package.json        # Dependencies
├── Generated/          # Generated robot images
├── Reference Images/   # Reference robot designs
└── Png/               # Additional reference images
```

## Environment Variables

The API keys are currently hardcoded in `server.js`. For production use, consider using environment variables:

```bash
OPENAI_API_KEY=your_openai_key
GOOGLE_API_KEY=your_google_key
```

## Development

### Running in Development Mode
```bash
npm run dev
```

This uses nodemon for automatic server restarts on file changes.

### Adding New Models

To add a new model:
1. Add the model option to the dropdown in `index.html`
2. Implement a `generateWith[ModelName]` function in `server.js`
3. Update the `/api/generate` endpoint to handle the new model
4. Add test functionality in `/api/test-model`

## Troubleshooting

### Model Test Fails
- Verify API keys are correct
- Check network connectivity
- Ensure API quotas haven't been exceeded

### Images Not Generating
- Check console logs in browser developer tools
- Review server logs for detailed error messages
- Verify reference images are present

### High Costs
- Use Google Gemini for cost-effective generation
- Leverage caching by reusing common prompts
- Monitor the cost summary panel

## License

MIT