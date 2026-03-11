Use this prompt in Codex on the other PC where Ollama is installed:

```text
This project already supports Gemini, OpenRouter, and a local Ollama-backed LLM in the UI, but I want you to verify and finish the local-runtime path on this machine.

Project:
D:\genai-budget-planner

Context:
- Backend: D:\genai-budget-planner\budget-ai-backend
- Frontend: D:\genai-budget-planner\budget-ai-frontend
- The app generates budget reports, stores them in MySQL, stores report chunks in ChromaDB, and supports a RAG chatbot.
- Gemini and OpenRouter are already wired.
- On this machine, Ollama is installed, so I want the true local LLM path tested and completed.

Goals:
1. Verify that all three text-model options work end-to-end:
   - Gemini
   - OpenRouter
   - Local LLM via Ollama
2. Keep the current frontend design/layout unchanged.
3. Make the backend/provider layer robust and explicit for all three providers.
4. Improve provider-specific debugging messages if any provider fails.
5. If needed, add a lightweight provider-health/debug endpoint, but preserve existing routes.
6. Confirm the budget-summary flow and chatbot flow both work with the local Ollama model.

Local LLM expectations:
- Use the configured OLLAMA_URL and OLLAMA_MODEL from the backend .env.
- If Ollama is reachable but the model is missing, return a precise error saying the model is not installed/pulled.
- If Ollama is unreachable, return a precise connection error.
- Do not silently fall back to a different provider when "Local LLM" is selected.

Checks to run:
- Start backend and frontend.
- Verify /ai/providers/status (or equivalent) reports local connectivity correctly.
- Generate one sample budget report with each provider.
- Test the chatbot with each provider.
- If a temporary test record is created, clean it up after verification.

Deliverables:
- Make any necessary code fixes.
- Summarize what was broken, what you changed, and which of the three providers passed verification.
- Include any remaining setup instructions if something depends on local machine state.
```
