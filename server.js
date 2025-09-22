const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const OpenAI = require('openai');
const sharp = require('sharp');
const FormData = require('form-data');
const axios = require('axios');

const app = express();
const PORT = 3000;

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: 'process.env.OPENAI_API_KEY'
});

// Middleware
app.use(express.json());
app.use(express.static(__dirname));
app.use('/generated', express.static(path.join(__dirname, 'Generated')));
app.use('/reference', express.static(path.join(__dirname, 'Reference Images')));

// Ensure Generated directory exists
async function ensureGeneratedDir() {
    const dir = path.join(__dirname, 'Generated');
    try {
        await fs.access(dir);
    } catch {
        await fs.mkdir(dir, { recursive: true });
        console.log('Created Generated directory');
    }
}

// Load reference images
async function loadReferenceImages() {
    const refDir = path.join(__dirname, 'Reference Images');
    try {
        const files = await fs.readdir(refDir);
        const imageFiles = files.filter(file => 
            /\.(png|jpg|jpeg)$/i.test(file)
        );
        console.log(`Found ${imageFiles.length} reference images`);
        return imageFiles.map(file => path.join(refDir, file));
    } catch (error) {
        console.error('Error loading reference images:', error);
        return [];
    }
}

// Convert images to base64 for API
async function imageToBase64(imagePath) {
    try {
        const imageBuffer = await fs.readFile(imagePath);
        return `data:image/png;base64,${imageBuffer.toString('base64')}`;
    } catch (error) {
        console.error(`Error reading image ${imagePath}:`, error);
        return null;
    }
}

// Optimized base prompt
const BASE_PROMPT = `You are creating a robot avatar for programming languages and technical concepts.

Style Guidelines:
- Inspired by the reference robot images provided
- Realistic 3D rendering
- Slight grunge, lived in, and worn down look
- White background for consistency
- Robot facing slightly left (3/4 view)
- Friendly and approachable design (think Wall-E, not Terminator)
- Each robot must be visually distinct with unique:
  * Color scheme that matches the language/concept's brand colors
  * Head shape and design elements
  * Body features and details
  * Subtle thematic elements related to the concept
- Must only have 1 robot, no other objects or characters on the image

Technical Requirements:
- Square aspect ratio (1:1)
- High quality, detailed rendering
- No text or labels on the robot
- Professional profile picture quality

The robot should embody the essence of the programming language or concept through its design, colors, and subtle visual metaphors.`;

// Research function using GPT-4 with web search
async function researchConcept(concept) {
    try {
        console.log(`Researching: ${concept}`);
        
        const response = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant that researches programming languages and technical concepts to understand their visual identity, brand colors, and key characteristics."
                },
                {
                    role: "user",
                    content: `Research the programming language or technical concept "${concept}". 
                    Provide:
                    1. Official brand colors (hex codes if available)
                    2. Key visual characteristics or logo elements
                    3. Core philosophy or personality traits
                    4. Any associated imagery or metaphors
                    Keep the response concise and focused on visual/design elements.`
                }
            ],
            max_tokens: 300
        });

        const research = response.choices[0].message.content;
        console.log('Research completed:', research);
        return research;
    } catch (error) {
        console.error('Research error:', error);
        // Fallback to basic prompt if research fails
        return `Creating a robot for ${concept}`;
    }
}

// Generate image endpoint
app.post('/api/generate', async function(req, res) {
    try {
        const { prompt } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        console.log(`Generating robot for: ${prompt}`);

        // Research the concept
        const research = await researchConcept(prompt);

        // Load reference images
        const referenceImages = await loadReferenceImages();
        const referenceBase64 = [];
        
        // Convert first 3 reference images to base64 (to avoid token limits)
        for (let i = 0; i < Math.min(3, referenceImages.length); i++) {
            const base64 = await imageToBase64(referenceImages[i]);
            if (base64) {
                referenceBase64.push(base64);
            }
        }

        // Construct the final prompt
        const finalPrompt = `${BASE_PROMPT}

Research findings for ${prompt}:
${research}

Now create a unique robot avatar that represents "${prompt}" based on the research above and the reference style images provided.`;

        console.log('Calling OpenAI Image Generation API...');

        // Generate image using DALL-E 3
        const response = await openai.images.generate({
            model: "dall-e-3",
            prompt: finalPrompt,
            n: 1,
            size: "1024x1024",
            quality: "hd",
            style: "natural"
        });

        const imageUrl = response.data[0].url;
        
        if (!imageUrl) {
            throw new Error('No image URL returned from OpenAI');
        }

        console.log('Image generated successfully');

        // Download the image
        const imageResponse = await axios.get(imageUrl, {
            responseType: 'arraybuffer'
        });
        
        // Save the image
        const filename = `${prompt.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`;
        const filepath = path.join(__dirname, 'Generated', filename);
        
        await fs.writeFile(filepath, imageResponse.data);
        console.log(`Image saved as: ${filename}`);

        res.json({
            success: true,
            filename: filename,
            research: research.substring(0, 200) + '...' // Send truncated research for UI
        });

    } catch (error) {
        console.error('Generation error:', error);
        res.status(500).json({
            error: error.message || 'Failed to generate image',
            details: error.response?.data || error
        });
    }
});

// Gallery endpoint
app.get('/api/gallery', async function(req, res) {
    try {
        const dir = path.join(__dirname, 'Generated');
        await ensureGeneratedDir();
        
        const files = await fs.readdir(dir);
        const images = files
            .filter(file => /\.(png|jpg|jpeg)$/i.test(file))
            .map(filename => ({
                filename: filename,
                name: filename.replace(/_\d+\.(png|jpg|jpeg)$/i, '').replace(/_/g, ' ')
            }))
            .reverse(); // Show newest first
        
        res.json(images);
    } catch (error) {
        console.error('Gallery error:', error);
        res.status(500).json({ error: 'Failed to load gallery' });
    }
});

// Start server
async function startServer() {
    await ensureGeneratedDir();
    
    app.listen(PORT, () => {
        console.log(`
╔══════════════════════════════════════════════╗
║     🤖 Robot Image Generator Server          ║
║                                              ║
║     Server running at:                       ║
║     http://localhost:${PORT}                     ║
║                                              ║
║     Press Ctrl+C to stop                     ║
╚══════════════════════════════════════════════╝
        `);
    });
}

startServer().catch(console.error);
