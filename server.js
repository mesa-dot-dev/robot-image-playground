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

// Load reference images - now with random selection
async function loadReferenceImages(limit = 10) {
    const refDir = path.join(__dirname, 'Reference Images');
    try {
        const files = await fs.readdir(refDir);
        const imageFiles = files.filter(file => 
            /\.(png|jpg|jpeg)$/i.test(file)
        );
        
        // Randomly select up to 'limit' images
        const shuffled = imageFiles.sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, Math.min(limit, imageFiles.length));
        
        console.log(`Selected ${selected.length} random reference images from ${imageFiles.length} total`);
        return selected.map(file => path.join(refDir, file));
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

// Analyze reference images using GPT-4 Vision to extract style
async function analyzeReferenceStyle(referenceImages) {
    try {
        console.log('Analyzing reference images for style...');
        
        // Convert images to base64
        const imagePromises = referenceImages.slice(0, 5).map(async (imagePath) => {
            const base64 = await imageToBase64(imagePath);
            return base64;
        });
        
        const base64Images = (await Promise.all(imagePromises)).filter(img => img !== null);
        
        if (base64Images.length === 0) {
            console.log('No reference images could be loaded');
            return getDefaultStyleDescription();
        }
        
        // Create messages with images for GPT-4 Vision
        const messages = [
            {
                role: "system",
                content: "You are an expert art director analyzing robot designs to extract their visual style."
            },
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: `Analyze these robot images and provide a detailed style guide for creating similar robots. Focus on:
                        1. Overall aesthetic (realistic, stylized, retro-futuristic, etc.)
                        2. Material and texture details (metal type, wear patterns, surface finish)
                        3. Color palette approach
                        4. Head and body proportions
                        5. Eye/face design patterns
                        6. Level of detail and complexity
                        7. Lighting and rendering style
                        8. Any consistent design elements across the robots
                        
                        Provide a concise but detailed description that could be used to generate similar robots.`
                    },
                    ...base64Images.map(img => ({
                        type: "image_url",
                        image_url: {
                            url: img,
                            detail: "low"
                        }
                    }))
                ]
            }
        ];
        
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: messages,
            max_tokens: 500
        });
        
        const styleAnalysis = response.choices[0].message.content;
        console.log('Style analysis completed');
        return styleAnalysis;
        
    } catch (error) {
        console.error('Error analyzing reference style:', error);
        return getDefaultStyleDescription();
    }
}

// Default style description if analysis fails
function getDefaultStyleDescription() {
    return `Create a robot in a retro-futuristic style with:
    - Weathered, matte metal surfaces with visible wear and patina
    - Rounded, friendly proportions similar to Wall-E
    - Large expressive eyes with subtle glow
    - Muted color palette with one accent color
    - Visible mechanical details like joints, panels, and rivets
    - Soft studio lighting on white background
    - 3/4 view angle facing slightly left`;
}

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

        // Load and analyze reference images for style
        const referenceImages = await loadReferenceImages(10); // Get 10 random images
        const styleGuide = await analyzeReferenceStyle(referenceImages);
        
        // Research the specific concept
        const research = await researchConcept(prompt);

        // Construct a detailed prompt combining style analysis and concept research
        const finalPrompt = `Create a robot avatar following this exact style guide:

${styleGuide}

IMPORTANT STYLE REQUIREMENTS:
- Match the exact aesthetic of the reference robots
- Use similar material textures and wear patterns
- Maintain consistent proportions and design language
- White or light background
- Robot facing slightly left (3/4 view)
- Single robot only, no additional objects
- Square image composition
- No text or labels

CONCEPT DETAILS for "${prompt}":
${research}

Combine the style guide above with the concept research to create a robot that:
1. Perfectly matches the visual style of the reference robots
2. Incorporates the brand colors and personality of ${prompt}
3. Uses subtle visual metaphors related to ${prompt}
4. Maintains the friendly, approachable character

The robot must look like it belongs in the same universe as the reference robots while uniquely representing ${prompt}.`;

        console.log('Calling OpenAI Image Generation API with gpt-image-1...');

        // Generate image using gpt-image-1 (latest model with reference image support)
        const response = await openai.images.generate({
            model: "gpt-image-1",
            prompt: finalPrompt,
            n: 1,
            size: "1024x1024",
            quality: "high"
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
