require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const OpenAI = require('openai');
const sharp = require('sharp');
const FormData = require('form-data');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = 3000;

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Initialize Google Gemini client
const googleAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

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
async function analyzeReferenceStyle(referenceImages, model = 'openai', isUniqueConcept = false) {
    try {
        console.log('Analyzing reference images for style...');
        
        // Convert images to base64
        const imagePromises = referenceImages.slice(0, 8).map(async (imagePath) => {
            const base64 = await imageToBase64(imagePath);
            return base64;
        });
        
        const base64Images = (await Promise.all(imagePromises)).filter(img => img !== null);
        
        if (base64Images.length === 0) {
            console.log('No reference images could be loaded');
            return getDefaultStyleDescription();
        }
        
        const analysisPrompt = isUniqueConcept 
            ? `Analyze these robot images to extract ONLY the rendering style and quality. Focus on:
        1. 3D rendering technique and quality
        2. Material properties (metallic, plastic, matte, glossy)
        3. Lighting setup and shadows
        4. Background style
        5. Overall polish and professional quality
        
        IMPORTANT: Do NOT describe the specific robot designs, shapes, or forms. We want to understand the RENDERING STYLE only, not the robot designs themselves.
        The goal is to match the rendering quality while creating a completely different robot design.`
            : `Analyze these robot images and provide a detailed style guide for creating similar robots. Focus on:
        1. Overall aesthetic (realistic, stylized, retro-futuristic, etc.)
        2. Material and texture details (metal type, wear patterns, surface finish)
        3. Color palette approach
        4. Head and body proportions
        5. Eye/face design patterns
        6. Level of detail and complexity
        7. Lighting and rendering style
        8. Any consistent design elements across the robots
        
        Provide a concise but detailed description that could be used to generate similar robots.`;
        
        if (model === 'google') {
            // Use Google Gemini for analysis
            try {
                const parts = [
                    { text: analysisPrompt },
                    ...base64Images.map(img => ({
                        inlineData: {
                            mimeType: 'image/png',
                            data: img.split(',')[1] // Remove data:image/png;base64, prefix
                        }
                    }))
                ];
                
                const model = googleAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
                const result = await model.generateContent(parts);
                
                const response = await result.response;
                const styleAnalysis = response.text();
                console.log('Style analysis completed with Google Gemini');
                return styleAnalysis;
            } catch (error) {
                console.error('Google Gemini analysis failed, falling back to OpenAI:', error);
                // Fall back to OpenAI if Google fails
            }
        }
        
        // Use OpenAI for analysis (default or fallback)
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
                        text: analysisPrompt
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
        console.log('Style analysis completed with OpenAI');
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

// Research function using GPT-4 or Gemini
async function researchConcept(concept, model = 'openai') {
    try {
        console.log(`Researching: ${concept} using ${model}`);
        
        const researchPrompt = `Research the concept "${concept}". 
        
        First, determine if this is:
        A) A known programming language, framework, or technology (like Python, React, etc.)
        B) A unique/custom concept that doesn't exist as a standard technology
        
        If it's A (known technology):
        1. Official brand colors (hex codes if available)
        2. Key visual characteristics or logo elements
        3. Core philosophy or personality traits
        4. Any associated imagery or metaphors
        
        If it's B (unique concept like "Concurrency Checker"):
        1. Break down what the concept might mean or do
        2. Suggest visual metaphors that represent this concept
        3. Recommend colors and design elements that would be appropriate
        4. Ensure the suggestions are UNIQUE and don't copy existing tech brands
        
        Keep the response concise and focused on visual/design elements.`;
        
        if (model === 'google') {
            // Use Google Gemini for research
            try {
        const model = googleAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
        const result = await model.generateContent(researchPrompt);
                
                const response = await result.response;
                const research = response.text();
                console.log('Research completed with Google Gemini:', research);
                return research;
            } catch (error) {
                console.error('Google Gemini research failed, falling back to OpenAI:', error);
                // Fall back to OpenAI if Google fails
            }
        }
        
        // Use OpenAI for research (default or fallback)
        const response = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant that researches programming languages and technical concepts to understand their visual identity, brand colors, and key characteristics."
                },
                {
                    role: "user",
                    content: researchPrompt
                }
            ],
            max_tokens: 300
        });

        const research = response.choices[0].message.content;
        console.log('Research completed with OpenAI:', research);
        return research;
    } catch (error) {
        console.error('Research error:', error);
        // Fallback to basic prompt if research fails
        return `Creating a robot for ${concept}`;
    }
}

// Build the generation prompt (shared between models)
async function buildGenerationPrompt(prompt, referenceImages, relatedRobots, extensiveThinking = true) {
        const thinkingStartTime = Date.now();
        
        // Check if this is a unique/non-standard concept (not a known programming language or tech)
        const isUniqueConcept = relatedRobots.length === 0;
        
        const styleGuide = extensiveThinking ? await analyzeReferenceStyle(referenceImages, 'openai', isUniqueConcept) : getDefaultStyleDescription();
        const research = extensiveThinking ? await researchConcept(prompt) : `Creating a robot for ${prompt}`;
        
        const thinkingTime = Date.now() - thinkingStartTime;
        if (extensiveThinking) {
            console.log(`Thinking/Research completed in ${(thinkingTime / 1000).toFixed(1)}s`);
        }
        
        // For unique concepts, we need to ensure the robot is distinctly different
        const uniquenessInstruction = isUniqueConcept 
            ? `\n⚠️ CRITICAL UNIQUENESS REQUIREMENT ⚠️
This is "${prompt}" - a UNIQUE CONCEPT not found in existing robots or programming languages.

MANDATORY: Create a COMPLETELY ORIGINAL robot design that:
1. MUST BE DISTINCTLY DIFFERENT from ALL reference images shown
2. Should NOT resemble any specific reference robot
3. Use the reference images ONLY for understanding the general 3D rendering style and quality
4. Create a UNIQUE form/shape/character that represents "${prompt}" conceptually
5. DO NOT copy or closely imitate any reference robot's body shape, head design, or overall form
6. Invent NEW design elements specific to "${prompt}"

The reference images are provided ONLY to show the rendering quality and style (3D, materials, lighting) - NOT to copy their designs.
Create something ENTIRELY NEW while maintaining the same professional 3D rendering quality.\n`
            : '';

        const relatedInfo = relatedRobots.length > 0 
            ? `\nCRITICAL: The reference images include base robots for: ${relatedRobots.map(r => r.name).join(', ')}. 
            
KEY INSTRUCTION: The new "${prompt}" robot MUST maintain the CORE VISUAL IDENTITY of these base robots:
- If the base is a snake head (like Python), this should also be a snake head
- If the base is a particular shape/form, maintain that shape/form
- Keep the fundamental character/creature type the same
- Add variations and details specific to "${prompt}" but DO NOT change the core identity

Think of this as creating a variant or evolution of the base robot, not a completely different robot.\n`
            : uniquenessInstruction;
            
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

${isUniqueConcept 
    ? `REMEMBER: "${prompt}" is a UNIQUE concept - create an ORIGINAL robot design that doesn't copy any reference robot's form!`
    : `IMPORTANT: This is "${prompt}" - create a VARIANT of the base robot(s) that maintains their core visual identity (same creature/form/shape) while adding elements specific to "${prompt}". Do NOT create a completely different robot - think of this as the same robot family with modifications.`}

REMINDER: NO TEXT ON THE ROBOT - Do not write "${prompt}" or any text on the robot. Express the concept through design, colors, and form only.`;

    return { finalPrompt, research, styleGuide, thinkingTime };
}

// Generate image using Google Gemini
async function generateWithGoogle(prompt, referenceImages, relatedRobots, extensiveThinking = true) {
    console.log('Using Google Gemini 2.5 Flash Image (Nano Banana) for generation');
    
    const { finalPrompt, research, thinkingTime } = await buildGenerationPrompt(prompt, referenceImages, relatedRobots, extensiveThinking);
    
    // Process reference images for Google
    const referenceBase64Images = [];
    console.log(`Processing ${referenceImages.length} reference images for Google...`);
    
    for (let i = 0; i < Math.min(referenceImages.length, 10); i++) { // Google now supports up to 10 images
        const imagePath = referenceImages[i];
        try {
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
    
    // Build content array for Google
    const parts = [
        { text: finalPrompt }
    ];
    
    // Add reference images
    for (const base64Image of referenceBase64Images) {
        parts.push({
            inlineData: {
                mimeType: 'image/jpeg',
                data: base64Image
            }
        });
    }
    
    // Generate with Google Gemini
    const model = googleAI.getGenerativeModel({ model: 'gemini-2.5-flash-image-preview' });
    const result = await model.generateContent(parts);
    
    // Extract the generated image from the response
    let imageData = null;
    const response = await result.response;
    for (const candidate of response.candidates || []) {
        for (const part of candidate.content.parts || []) {
            if (part.inlineData) {
                imageData = part.inlineData.data;
                break;
            }
        }
        if (imageData) break;
    }
    
    if (!imageData) {
        throw new Error('No image data returned from Google Gemini');
    }
    
    // Calculate cost for Google Gemini
    // $30 per 1 million output tokens, each image is 1290 tokens
    const imageTokens = 1290;
    const cost = (imageTokens / 1000000) * 30.00;
    
    console.log('Google Gemini generation completed');
    console.log(`Cost: $${cost.toFixed(4)} (${imageTokens} output tokens at $30/1M)`);
    
    return {
        imageBuffer: Buffer.from(imageData, 'base64'),
        research: research.substring(0, 200) + '...',
        tokenUsage: {
            prompt_tokens: 0, // Google doesn't charge for input in image generation
            completion_tokens: 0,
            total_tokens: 0,
            image_tokens: imageTokens,
            estimated_cost: cost
        },
        cost: `$${cost.toFixed(4)}`
    };
}

// Generate image using OpenAI
async function generateWithOpenAI(prompt, referenceImages, relatedRobots, extensiveThinking = true) {
    console.log('Using OpenAI GPT-4o with image generation tool');
    
    const { finalPrompt, research, thinkingTime } = await buildGenerationPrompt(prompt, referenceImages, relatedRobots, extensiveThinking);
    
    // Process reference images for OpenAI
    const referenceBase64Images = [];
    console.log(`Processing ${referenceImages.length} reference images for OpenAI...`);
    
    for (let i = 0; i < referenceImages.length; i++) {
        const imagePath = referenceImages[i];
        try {
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
    const response = await openai.responses.create({
        model: "gpt-4o",
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
                input_fidelity: "high"
                    }
                ]
            });

        // Extract image data from Responses API response
        const imageGenerationCalls = response.output?.filter(
            output => output.type === 'image_generation_call'
        ) || [];
        
        if (imageGenerationCalls.length === 0 || !imageGenerationCalls[0].result) {
            throw new Error('No image data returned from OpenAI Responses API');
        }
        
        const imageBase64Result = imageGenerationCalls[0].result;

        // Calculate token usage and cost
        let tokenInfo = {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            estimated_cost: 0
        };

        if (response.usage) {
            tokenInfo.prompt_tokens = response.usage.prompt_tokens || 0;
            tokenInfo.completion_tokens = response.usage.completion_tokens || 0;
            tokenInfo.total_tokens = response.usage.total_tokens || 0;
            
            // Calculate cost based on GPT-image-1 pricing
            const inputCost = (tokenInfo.prompt_tokens / 1000000) * 10.00;
            const outputCost = (tokenInfo.completion_tokens / 1000000) * 40.00;
            
        // Image generation tokens
            const imageTokens = 4160; // for high quality 1024x1024
            const imageCost = (imageTokens / 1000000) * 40.00;
            
            tokenInfo.estimated_cost = inputCost + outputCost + imageCost;
        tokenInfo.image_tokens = imageTokens;
            
        console.log('OpenAI Token Usage:', {
                prompt_tokens: tokenInfo.prompt_tokens,
                completion_tokens: tokenInfo.completion_tokens,
                image_tokens: imageTokens,
                total_tokens: tokenInfo.total_tokens + imageTokens,
                total_cost: `$${tokenInfo.estimated_cost.toFixed(4)}`
            });
        } else {
        // Estimate if no usage data
        const imageTokens = 4160;
        const estimatedPromptTokens = 500;
            const inputCost = (estimatedPromptTokens / 1000000) * 10.00;
            const imageCost = (imageTokens / 1000000) * 40.00;
            tokenInfo.estimated_cost = inputCost + imageCost;
        tokenInfo.image_tokens = imageTokens;
    }
    
    return {
        imageBuffer: Buffer.from(imageBase64Result, 'base64'),
        research: research.substring(0, 200) + '...',
        tokenUsage: tokenInfo,
        cost: `$${tokenInfo.estimated_cost.toFixed(4)}`
    };
}

// Find related robots for reference
async function findRelatedRobots(prompt) {
    const relatedRobots = [];
    const generatedDir = path.join(__dirname, 'Generated');
    const referenceDir = path.join(__dirname, 'Reference Images');
    const secondaryReferenceDir = path.join(__dirname, 'Secondary Reference Images');
    
    try {
        const generatedFiles = await fs.readdir(generatedDir);
        const referenceFiles = await fs.readdir(referenceDir);
        
        // Also read Secondary Reference Images folder
        let secondaryReferenceFiles = [];
        try {
            secondaryReferenceFiles = await fs.readdir(secondaryReferenceDir);
        } catch (error) {
            console.log('Secondary Reference Images folder not found or inaccessible');
        }
        
        // Extract potential robot names from the prompt
        const promptWords = prompt.toLowerCase().split(/[\s\-_,&+]/);
        const promptClean = prompt.toLowerCase().replace(/[^a-z0-9]/gi, '');
        
        // Get all existing robots
        const allExistingRobots = [];
        
        for (const file of generatedFiles) {
            if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')) {
                allExistingRobots.push({
                    name: path.basename(file, path.extname(file)).replace(/_\d{13}$/, ''),
                    path: path.join(generatedDir, file),
                    source: 'generated'
                });
            }
        }
        
        for (const file of referenceFiles) {
            if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')) {
                allExistingRobots.push({
                    name: path.basename(file, path.extname(file)),
                    path: path.join(referenceDir, file),
                    source: 'reference'
                });
            }
        }
        
        // Add robots from Secondary Reference Images folder
        for (const file of secondaryReferenceFiles) {
            if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')) {
                allExistingRobots.push({
                    name: path.basename(file, path.extname(file)),
                    path: path.join(secondaryReferenceDir, file),
                    source: 'secondary_reference'
                });
            }
        }
        
        // Look for related robots
        let foundSpecificMatch = false;
        
        // Try exact match
        for (const robot of allExistingRobots) {
            const robotNameClean = robot.name.toLowerCase().replace(/[^a-z0-9]/gi, '');
            if (robotNameClean === promptClean) {
                relatedRobots.push(robot);
                console.log(`Found EXACT match robot: ${robot.name}`);
                foundSpecificMatch = true;
                break;
            }
        }
        
        // If no exact match, look for word matches
        if (!foundSpecificMatch) {
            const foundBaseRobots = new Set();
            
            for (const word of promptWords) {
                const wordClean = word.replace(/[^a-z0-9]/gi, '').toLowerCase();
                if (wordClean.length < 2) continue;
                
                for (const robot of allExistingRobots) {
                    const robotNameClean = robot.name.toLowerCase().replace(/[^a-z0-9]/gi, '');
                    
                    if (robotNameClean === wordClean) {
                        if (!foundBaseRobots.has(robotNameClean)) {
                            foundBaseRobots.add(robotNameClean);
                            relatedRobots.push(robot);
                            console.log(`Found BASE robot: ${robot.name}`);
                        }
                        break;
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error finding related robots:', error);
    }
    
    return relatedRobots;
}

// Generate image endpoint
app.post('/api/generate', async function(req, res) {
    try {
        const { prompt, model = 'openai', extensiveThinking = true } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        console.log(`Generating robot for: ${prompt} using ${model}${extensiveThinking ? ' with extensive thinking' : ' (fast mode)'}`);
        
        // Handle "both" option - generate with both models in parallel
        if (model === 'both') {
            console.log('Generating with both models in parallel...');
            
            // Check for cached versions first
            const normalizedPrompt = prompt.toLowerCase().replace(/[^a-z0-9]/gi, '_');
            const generatedDir = path.join(__dirname, 'Generated');
            const generatedFiles = await fs.readdir(generatedDir);
            
            // Look for existing OpenAI and Google versions
            const openaiCached = generatedFiles.find(file => {
                const fileName = path.basename(file, path.extname(file)).toLowerCase();
                // Remove timestamp suffix if present
                const fileNameWithoutTimestamp = fileName.replace(/_\d{13}$/, '');
                // Check for exact match with model suffix
                return fileNameWithoutTimestamp === normalizedPrompt + '_openai';
            });
            
            const googleCached = generatedFiles.find(file => {
                const fileName = path.basename(file, path.extname(file)).toLowerCase();
                // Remove timestamp suffix if present
                const fileNameWithoutTimestamp = fileName.replace(/_\d{13}$/, '');
                // Check for exact match with model suffix
                return fileNameWithoutTimestamp === normalizedPrompt + '_google';
            });
            
            const results = {};
            const promises = [];
            
            // Prepare shared resources
            const relatedRobots = await findRelatedRobots(prompt);
            let referenceImages = [];
            if (relatedRobots.length > 0) {
                console.log(`Using ${relatedRobots.length} related robots as ONLY references (no random filling)`);
                referenceImages = relatedRobots.map(r => r.path);
            } else {
                console.log(`⚠️ UNIQUE CONCEPT DETECTED: "${prompt}" - No related robots found`);
                console.log('Loading random reference images for STYLE ONLY (not design copying)');
                referenceImages = await loadReferenceImages(10);
            }
            
            // Generate with OpenAI (or use cache)
            if (openaiCached) {
                console.log(`Found cached OpenAI image: ${openaiCached}`);
                results.openai = {
                    success: true,
                    filename: openaiCached,
                    cached: true,
                    cost: '$0.0000'
                };
            } else {
                promises.push(
                    generateWithOpenAI(prompt, referenceImages, relatedRobots, extensiveThinking)
                        .then(result => {
                            const filename = `${normalizedPrompt}_openai_${Date.now()}.png`;
                            const filepath = path.join(generatedDir, filename);
                            return fs.writeFile(filepath, result.imageBuffer).then(() => {
                                console.log(`OpenAI image saved as: ${filename}`);
                                results.openai = {
                                    success: true,
                                    filename: filename,
                                    cost: result.cost,
                                    tokenUsage: result.tokenUsage
                                };
                            });
                        })
                        .catch(error => {
                            console.error('OpenAI generation failed:', error);
                            results.openai = {
                                success: false,
                                error: error.message
                            };
                        })
                );
            }
            
            // Generate with Google (or use cache)
            if (googleCached) {
                console.log(`Found cached Google image: ${googleCached}`);
                results.google = {
                    success: true,
                    filename: googleCached,
                    cached: true,
                    cost: '$0.0000'
                };
            } else {
                promises.push(
                    generateWithGoogle(prompt, referenceImages, relatedRobots, extensiveThinking)
                        .then(result => {
                            const filename = `${normalizedPrompt}_google_${Date.now()}.png`;
                            const filepath = path.join(generatedDir, filename);
                            return fs.writeFile(filepath, result.imageBuffer).then(() => {
                                console.log(`Google image saved as: ${filename}`);
                                results.google = {
                                    success: true,
                                    filename: filename,
                                    cost: result.cost,
                                    tokenUsage: result.tokenUsage
                                };
                            });
                        })
                        .catch(error => {
                            console.error('Google generation failed:', error);
                            results.google = {
                                success: false,
                                error: error.message
                            };
                        })
                );
            }
            
            // Wait for all generations to complete
            await Promise.all(promises);
            
            // Return combined results
            res.json({
                success: true,
                results: results,
                research: `Generated images for "${prompt}" using both models`
            });
            return;
        }
        
        // First check if we already have this robot
        const normalizedPrompt = prompt.toLowerCase().replace(/[^a-z0-9]/gi, '_');
        
        // Check in Generated folder
        const generatedDir = path.join(__dirname, 'Generated');
        const generatedFiles = await fs.readdir(generatedDir);
        const existingGenerated = generatedFiles.find(file => {
            const fileName = path.basename(file, path.extname(file)).toLowerCase();
            // Remove timestamp suffix if present (e.g., "_1758663007797")
            const fileNameWithoutTimestamp = fileName.replace(/_\d{13}$/, '');
            // Check for exact match only (don't remove model suffixes here - those are separate images)
            return fileNameWithoutTimestamp === normalizedPrompt;
        });
        
        if (existingGenerated) {
            console.log(`Found existing generated robot: ${existingGenerated}`);
            res.json({
                success: true,
                filename: existingGenerated,
                research: `Using existing generated robot for ${prompt}`,
                cached: true,
                tokenUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost: 0 },
                cost: '$0.0000'
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
            // Only exact match, not substring
            return fileNameClean === searchTerm;
        });
        
        if (existingReference) {
            console.log(`Found existing reference robot: ${existingReference}`);
            const sourceFile = path.join(referenceDir, existingReference);
            const filename = `${normalizedPrompt}_${Date.now()}.png`;
            const destFile = path.join(generatedDir, filename);
            
            const imageBuffer = await fs.readFile(sourceFile);
            await fs.writeFile(destFile, imageBuffer);
            
            res.json({
                success: true,
                filename: filename,
                research: `Using existing reference robot for ${prompt}`,
                cached: true,
                source: 'reference',
                tokenUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost: 0 },
                cost: '$0.0000'
            });
            return;
        }
        
        // Check in Secondary Reference Images folder
        const secondaryReferenceDir = path.join(__dirname, 'Secondary Reference Images');
        try {
            const secondaryReferenceFiles = await fs.readdir(secondaryReferenceDir);
            const existingSecondaryReference = secondaryReferenceFiles.find(file => {
                const fileName = path.basename(file, path.extname(file)).toLowerCase();
                const searchTerm = prompt.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/gi, '');
                const fileNameClean = fileName.replace(/[^a-z0-9]/gi, '').toLowerCase();
                // Only exact match, not substring
                return fileNameClean === searchTerm;
            });
            
            if (existingSecondaryReference) {
                console.log(`Found existing secondary reference robot: ${existingSecondaryReference}`);
                const sourceFile = path.join(secondaryReferenceDir, existingSecondaryReference);
                const filename = `${normalizedPrompt}_${Date.now()}.png`;
                const destFile = path.join(generatedDir, filename);
                
                const imageBuffer = await fs.readFile(sourceFile);
                await fs.writeFile(destFile, imageBuffer);
                
                res.json({
                    success: true,
                    filename: filename,
                    research: `Using existing secondary reference robot for ${prompt}`,
                    cached: true,
                    source: 'secondary_reference',
                    tokenUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost: 0 },
                    cost: '$0.0000'
                });
                return;
            }
        } catch (error) {
            console.log('Secondary Reference Images folder not found or inaccessible');
        }
        
        // If no existing robot found, proceed with generation
        console.log('No existing robot found, generating new one...');
        
        // Track timing
        const overallStartTime = Date.now();
        let thinkingTime = 0;
        let generationTime = 0;
        
        // Start thinking phase timing
        const thinkingStartTime = Date.now();
        
        // Find related robots and load reference images
        const relatedRobots = await findRelatedRobots(prompt);
        
        let referenceImages = [];
        if (relatedRobots.length > 0) {
            console.log(`Using ${relatedRobots.length} related robots as ONLY references (no random filling)`);
            referenceImages = relatedRobots.map(r => r.path);
        } else {
            console.log(`⚠️ UNIQUE CONCEPT DETECTED: "${prompt}" - No related robots found`);
            console.log('Loading random reference images for STYLE ONLY (not design copying)');
            referenceImages = await loadReferenceImages(10);
        }
        
        // End thinking phase timing (if extensive thinking is enabled)
        thinkingTime = Date.now() - thinkingStartTime;
        const generationStartTime = Date.now();
        
        // Generate image based on selected model
        let result;
        if (model === 'google') {
            result = await generateWithGoogle(prompt, referenceImages, relatedRobots, extensiveThinking);
        } else {
            result = await generateWithOpenAI(prompt, referenceImages, relatedRobots, extensiveThinking);
        }
        
        // Save the image
        const filename = `${normalizedPrompt}_${Date.now()}.png`;
        const filepath = path.join(__dirname, 'Generated', filename);
        
        await fs.writeFile(filepath, result.imageBuffer);
        console.log(`Image saved as: ${filename}`);
        
        // Calculate generation time
        generationTime = Date.now() - generationStartTime;
        
        // Add thinking time from buildGenerationPrompt if available
        if (result.thinkingTime) {
            thinkingTime += result.thinkingTime;
            generationTime -= result.thinkingTime; // Subtract thinking time from generation time
        }

        res.json({
            success: true,
            filename: filename,
            research: result.research,
            tokenUsage: result.tokenUsage,
            cost: result.cost,
            timings: {
                thinkingTime: extensiveThinking ? thinkingTime : 0,
                generationTime: generationTime,
                totalTime: Date.now() - overallStartTime
            }
        });

    } catch (error) {
        console.error('Generation error:', error);
        res.status(500).json({
            error: error.message || 'Failed to generate image',
            details: error.response?.data || error
        });
    }
});

// Test model endpoint
app.post('/api/test-model', async function(req, res) {
    try {
        const { model = 'openai' } = req.body;
        
        console.log(`Testing ${model} model...`);
        
        if (model === 'google') {
            // Test Google Gemini
            const testPrompt = "Say 'Google Gemini is working!' and nothing else.";
            
            const model = googleAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
            const result = await model.generateContent(testPrompt);
            
            const response = await result.response;
            const text = response.text();
            console.log('Google Gemini test response:', text);
            
            // Test image generation capability
            const imageTestPrompt = "Create a simple test image of a small robot.";
            const imageModel = googleAI.getGenerativeModel({ model: 'gemini-2.5-flash-image-preview' });
            const imageResult = await imageModel.generateContent(imageTestPrompt);
            
            let hasImage = false;
            const imageResponse = await imageResult.response;
            for (const candidate of imageResponse.candidates || []) {
                for (const part of candidate.content.parts || []) {
                    if (part.inlineData) {
                        hasImage = true;
                        break;
                    }
                }
            }
            
            if (!hasImage) {
                throw new Error('Google Gemini image generation test failed - no image returned');
            }
            
            res.json({
                success: true,
                message: 'Google Gemini (Nano Banana) is working! Image generation tested successfully.',
                cost: '$0.0390' // Cost for one test image
            });
        } else {
            // Test OpenAI
            const response = await openai.chat.completions.create({
                model: "gpt-4",
                messages: [
                    {
                        role: "user",
                        content: "Say 'OpenAI is working!' and nothing else."
                    }
                ],
                max_tokens: 20
            });
            
            console.log('OpenAI test response:', response.choices[0].message.content);
            
            res.json({
                success: true,
                message: 'OpenAI GPT-4o is working!',
                cost: '$0.0001' // Approximate cost for test
            });
        }
    } catch (error) {
        console.error('Test error:', error);
        res.status(500).json({
            error: `${req.body.model === 'google' ? 'Google Gemini' : 'OpenAI'} test failed: ${error.message}`,
            details: error.response?.data || error.message
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
                name: filename.replace(/_\d{13}\.(png|jpg|jpeg)$/i, '').replace(/_/g, ' ')
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
║     Models available:                        ║
║     - OpenAI GPT-4o (Image Generation)       ║
║     - Google Gemini 2.5 Flash Image          ║
║                                              ║
║     Press Ctrl+C to stop                     ║
╚══════════════════════════════════════════════╝
        `);
    });
}

startServer().catch(console.error);