const { generateText } = require("./aiProviderService");

async function generateGeminiAdvice(prompt) {
  const result = await generateText({
    modelChoice: "gemini",
    prompt,
    temperature: 0.3
  });

  return result.text;
}

module.exports = {
  generateGeminiAdvice
};
