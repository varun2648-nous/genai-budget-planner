const express = require("express");
const { chatAssistant, ragAssistant } = require("../controllers/aiController");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.post("/ai/chat", asyncHandler(chatAssistant));
router.post("/ai/rag", asyncHandler(ragAssistant));

module.exports = router;
