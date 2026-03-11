const express = require("express");
const {
  createReportHandler,
  listReportsHandler,
  getReportHandler,
  deleteReportHandler
} = require("../controllers/reportController");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.post("/reports", asyncHandler(createReportHandler));
router.get("/reports", asyncHandler(listReportsHandler));
router.get("/reports/:id", asyncHandler(getReportHandler));
router.delete("/reports/:id", asyncHandler(deleteReportHandler));

module.exports = router;
