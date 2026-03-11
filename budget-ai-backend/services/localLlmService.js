const { generateText } = require("./aiProviderService");

async function generateLocalResponse(prompt, options = {}) {
  const result = await generateText({
    modelChoice: "local",
    prompt,
    temperature: options.temperature ?? 0.3
  });

  return result.text;
}

module.exports = {
  generateLocalResponse
};
