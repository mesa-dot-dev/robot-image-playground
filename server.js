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
    - Muted color palette
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
        
        // First check if we already have this robot
        const normalizedPrompt = prompt.toLowerCase().replace(/[^a-z0-9]/gi, '_');
        
        // Check in Generated folder
        const generatedDir = path.join(__dirname, 'Generated');
        const generatedFiles = await fs.readdir(generatedDir);
        const existingGenerated = generatedFiles.find(file => {
            const fileName = path.basename(file, path.extname(file)).toLowerCase();
            // Check if filename starts with the normalized prompt (ignoring timestamp)
            return fileName.startsWith(normalizedPrompt + '_') || fileName === normalizedPrompt;
        });
        
        if (existingGenerated) {
            console.log(`Found existing generated robot: ${existingGenerated}`);
            res.json({
                success: true,
                filename: existingGenerated,
                research: `Using existing generated robot for ${prompt}`,
                cached: true
            });
            return;
        }
        
        // Check in Reference Images folder
        const referenceDir = path.join(__dirname, 'Reference Images');
        const referenceFiles = await fs.readdir(referenceDir);
        const existingReference = referenceFiles.find(file => {
            const fileName = path.basename(file, path.extname(file)).toLowerCase();
            const searchTerm = prompt.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/gi, '');
            const fileNameClean = fileName.replace(/[^a-z0-9]/gi, '').toLowerCase();
            return fileNameClean === searchTerm || fileName === prompt.toLowerCase();
        });
        
        if (existingReference) {
            console.log(`Found existing reference robot: ${existingReference}`);
            // Copy the reference image to Generated folder with timestamp
            const sourceFile = path.join(referenceDir, existingReference);
            const filename = `${normalizedPrompt}_${Date.now()}.png`;
            const destFile = path.join(generatedDir, filename);
            
            // Read and copy the file
            const imageBuffer = await fs.readFile(sourceFile);
            await fs.writeFile(destFile, imageBuffer);
            
            res.json({
                success: true,
                filename: filename,
                research: `Using existing reference robot for ${prompt}`,
                cached: true,
                source: 'reference'
            });
            return;
        }
        
        // If no existing robot found, proceed with generation
        console.log('No existing robot found, generating new one...');

        // Look for related robots to use as primary references
        let relatedRobots = [];
        
        // Extract potential robot names from the prompt (split by common delimiters)
        const promptWords = prompt.toLowerCase().split(/[\s\-_,&+]/);
        
        // Check both Generated and Reference folders for related robots
        const allExistingRobots = [];
        
        // Get all robots from Generated folder
        for (const file of generatedFiles) {
            if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')) {
                allExistingRobots.push({
                    name: path.basename(file, path.extname(file)).replace(/_\d+$/, ''), // Remove timestamp
                    path: path.join(generatedDir, file),
                    source: 'generated'
                });
            }
        }
        
        // Get all robots from Reference Images folder
        for (const file of referenceFiles) {
            if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')) {
                allExistingRobots.push({
                    name: path.basename(file, path.extname(file)),
                    path: path.join(referenceDir, file),
                    source: 'reference'
                });
            }
        }
        
        // Hierarchical search for related robots
        // 1. First try to find the most specific match (full prompt)
        // 2. Then try progressively less specific matches
        // 3. Finally fall back to individual word matches
        
        const promptClean = prompt.toLowerCase().replace(/[^a-z0-9]/gi, '');
        let foundSpecificMatch = false;
        
        // Level 1: Try exact match of full prompt (e.g., "Python Optimizer 2.0" -> "pythonoptimizer20")
        for (const robot of allExistingRobots) {
            const robotNameClean = robot.name.toLowerCase().replace(/[^a-z0-9]/gi, '');
            if (robotNameClean === promptClean) {
                relatedRobots.push(robot);
                console.log(`Found EXACT match robot: ${robot.name} from ${robot.source}`);
                foundSpecificMatch = true;
                break;
            }
        }
        
        // Level 2: If no exact match, try removing version numbers (e.g., "Python Optimizer 2.0" -> "Python Optimizer")
        if (!foundSpecificMatch) {
            const promptWithoutVersion = prompt.replace(/\s*\d+\.?\d*\s*$/gi, '').trim();
            const promptWithoutVersionClean = promptWithoutVersion.toLowerCase().replace(/[^a-z0-9]/gi, '');
            
            if (promptWithoutVersionClean !== promptClean) {
                for (const robot of allExistingRobots) {
                    const robotNameClean = robot.name.toLowerCase().replace(/[^a-z0-9]/gi, '');
                    if (robotNameClean === promptWithoutVersionClean) {
                        relatedRobots.push(robot);
                        console.log(`Found version-base match robot: ${robot.name} from ${robot.source}`);
                        foundSpecificMatch = true;
                        break;
                    }
                }
            }
        }
        
        // Level 3: If still no match, look for individual word matches (base robots)
        if (!foundSpecificMatch) {
            const foundBaseRobots = new Set();
            
            for (const word of promptWords) {
                const wordClean = word.replace(/[^a-z0-9]/gi, '').toLowerCase();
                if (wordClean.length < 2) continue;
                
                // Look for exact base robot matches (e.g., "python", "javascript", "optimizer")
                for (const robot of allExistingRobots) {
                    const robotNameClean = robot.name.toLowerCase().replace(/[^a-z0-9]/gi, '');
                    
                    // Exact match for this word
                    if (robotNameClean === wordClean) {
                        if (!foundBaseRobots.has(robotNameClean)) {
                            foundBaseRobots.add(robotNameClean);
                            relatedRobots.push(robot);
                            console.log(`Found BASE robot: ${robot.name} from ${robot.source}`);
                        }
                        break;
                    }
                }
            }
        }
        
        // Load reference images - prioritize related robots
        let referenceImages = [];
        
        if (relatedRobots.length > 0) {
            console.log(`Using ${relatedRobots.length} related robots as primary references`);
            // Use related robots as primary references
            referenceImages = relatedRobots.map(r => r.path);
            
            // If we have fewer than 10, add some random ones
            if (referenceImages.length < 10) {
                const additionalCount = 10 - referenceImages.length;
                const randomRefs = await loadReferenceImages(additionalCount);
                referenceImages = [...referenceImages, ...randomRefs];
            }
        } else {
            // No related robots found, use random references
            referenceImages = await loadReferenceImages(10);
        }
        
        const styleGuide = await analyzeReferenceStyle(referenceImages);
        
        // Research the specific concept
        const research = await researchConcept(prompt);

        // Process all reference images with better quality
        const referenceBase64Images = [];
        console.log(`Processing ${referenceImages.length} reference images...`);
        
        for (let i = 0; i < referenceImages.length; i++) {
            const imagePath = referenceImages[i];
            try {
                // Resize to maintain quality while being reasonable size
                const buffer = await sharp(imagePath)
                    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 85 })
                    .toBuffer();
                referenceBase64Images.push(buffer.toString('base64'));
                console.log(`Processed reference ${i + 1}: ${path.basename(imagePath)}`);
            } catch (err) {
                console.warn(`Failed to process reference image ${imagePath}: ${err}`);
            }
        }

        // Create a mask (optional - for now we'll generate without mask)
        // If we had a mask, it would specify which parts of the image to modify

        // Construct the prompt combining style analysis and concept research
        const relatedInfo = relatedRobots.length > 0 
            ? `\nCRITICAL: The reference images include base robots for: ${relatedRobots.map(r => r.name).join(', ')}. 
            
KEY INSTRUCTION: The new "${prompt}" robot MUST maintain the CORE VISUAL IDENTITY of these base robots:
- If the base is a snake head (like Python), this should also be a snake head
- If the base is a particular shape/form, maintain that shape/form
- Keep the fundamental character/creature type the same
- Add variations and details specific to "${prompt}" but DO NOT change the core identity

Think of this as creating a variant or evolution of the base robot, not a completely different robot.\n`
            : '';
            
        const finalPrompt = `Create a 3D rendered robot based on the reference images provided. The robot MUST match the exact 3D rendering style, materials, and quality of the reference robots - NOT a drawing or illustration.

CRITICAL: This should be a photorealistic 3D render, exactly like the reference images.

ABSOLUTELY NO TEXT: The robot must have NO TEXT, NO LETTERS, NO WORDS, NO LABELS anywhere on it. Do NOT write "${prompt}" or any other text on the robot's body, head, or any part. The robot should be completely text-free, just like the reference images.
${relatedInfo}
STYLE TO MAINTAIN (from reference analysis):
${styleGuide}

REQUIREMENTS:
- MUST be a 3D render, NOT a drawing or illustration
- Keep the EXACT same 3D rendering quality and style as references
- Same material textures (metal, plastic, etc) as reference robots
- Maintain similar proportions and mechanical details  
- Use the same photorealistic lighting and shading
- White background
- Robot facing slightly left (3/4 view)
- Single robot only, no additional objects
- Square image composition
- NO TEXT OR LABELS - absolutely no written words, letters, or numbers on the robot

${prompt.toUpperCase()} SPECIFIC CUSTOMIZATION:
${research}

IMPORTANT: This is "${prompt}" - create a VARIANT of the base robot(s) that maintains their core visual identity (same creature/form/shape) while adding elements specific to "${prompt}". Do NOT create a completely different robot - think of this as the same robot family with modifications.

REMINDER: NO TEXT ON THE ROBOT - Do not write "${prompt}" or any text on the robot. Express the concept through design, colors, and form only.`;

        console.log('Using Responses API with gpt-image-1');
        console.log('Calling OpenAI Responses API with image generation tool...');

        let response;
        try {
            // Build content array with text prompt and all reference images
            const contentArray = [
                {
                    type: "input_text",
                    text: finalPrompt
                }
            ];
            
            // Add all reference images
            for (const base64Image of referenceBase64Images) {
                contentArray.push({
                    type: "input_image",
                    image_url: `data:image/jpeg;base64,${base64Image}`
                });
            }
            
            // Use the Responses API with gpt-image-1
            response = await openai.responses.create({
                model: "gpt-4o", // Using a model that supports the image generation tool
                input: [
                    {
                        role: "user",
                        content: contentArray
                    }
                ],
                tools: [
                    {
                        type: "image_generation",
                        quality: "high",
                        size: "1024x1024",
                        input_fidelity: "high" // Preserve details from reference images
                    }
                ]
            });
        } catch (error) {
            console.error('API call error:', error.response?.data || error);
            throw error;
        }

        // Extract image data from Responses API response
        const imageGenerationCalls = response.output?.filter(
            output => output.type === 'image_generation_call'
        ) || [];
        
        if (imageGenerationCalls.length === 0 || !imageGenerationCalls[0].result) {
            console.log('API Response structure:', JSON.stringify(response, null, 2).substring(0, 500));
            throw new Error('No image data returned from OpenAI Responses API');
        }
        
        // The result is base64 encoded image data
        const imageBase64Result = imageGenerationCalls[0].result;

        console.log('Image generated successfully');

        // Convert base64 to buffer
        const imageBuffer = Buffer.from(imageBase64Result, 'base64');
        
        // Save the image
        const filename = `${prompt.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`;
        const filepath = path.join(__dirname, 'Generated', filename);
        
        await fs.writeFile(filepath, imageBuffer);
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
