# Robot Image Generator

Generate unique robot avatars for programming languages and technical concepts using OpenAI's DALL-E 3.

## Features

- 🤖 Generate unique robot avatars for any programming language or concept
- 🔍 Automatic research to match brand colors and characteristics
- 🎨 Uses reference images for consistent style
- 💾 Saves all generated images locally
- 🖼️ Gallery view of all generated robots
- 📊 Real-time console for debugging

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser and navigate to:
```
http://localhost:3000
```

## Usage

1. Enter a programming language or concept (e.g., "Python", "Security", "QA")
2. Click "Generate" or press Enter
3. Wait for the robot to be generated
4. View your generated robot and all previous creations in the gallery

## How It Works

1. **Research Phase**: The system researches the concept to understand brand colors and characteristics
2. **Reference Images**: Uses the images in `Reference Images/` folder as style guides
3. **Generation**: Creates a unique robot using DALL-E 3 with the combined context
4. **Storage**: Saves the generated image in the `Generated/` folder

## File Structure

```
Robot Image Playground/
├── index.html           # Main web interface
├── server.js           # Node.js backend server
├── package.json        # Dependencies
├── Reference Images/   # Style reference images
└── Generated/         # Output folder for generated robots
```

## API Configuration

The OpenAI API key is configured in `server.js`. Make sure you have sufficient credits for image generation.

## Troubleshooting

- **Console Output**: Check the bottom console on the webpage for detailed logs
- **Server Logs**: Check terminal output for server-side errors
- **API Errors**: Ensure your OpenAI API key is valid and has credits

## Notes

- Generated images are 1024x1024 pixels
- Images are displayed in circles but saved as squares
- Each generation costs OpenAI API credits
- The system limits reference images to 3 per request to avoid token limits
