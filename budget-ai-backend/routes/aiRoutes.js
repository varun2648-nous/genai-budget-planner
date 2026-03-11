const express = require("express");
const { chatAssistant, providerDebugStatus, providerStatus, ragAssistant } = require("../controllers/aiController");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.post("/ai/chat", asyncHandler(chatAssistant));
router.post("/ai/rag", asyncHandler(ragAssistant));
router.get("/ai/providers/debug", asyncHandler(providerDebugStatus));
router.get("/ai/providers/status", asyncHandler(providerStatus));

module.exports = router;
