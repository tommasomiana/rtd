const { createWorker } = require('tesseract.js');
const os = require('os');

/**
 * Runs OCR on an uploaded image buffer (e.g. a lineup poster screenshot)
 * and returns the raw extracted text. This is intentionally NOT trying to
 * be smart about parsing artist names out of the text — lineup posters use
 * all sorts of stylised layouts, so accuracy varies a lot depending on the
 * image. Instead, the extracted text is shown to the user in an editable
 * textarea so they can clean it up before matching artists, rather than
 * silently guessing wrong.
 *
 * Uses the explicit createWorker lifecycle (rather than the Tesseract.recognize
 * convenience wrapper) so that worker-initialisation failures — a common
 * source of silent "0 characters extracted" results in constrained/cloud
 * environments — surface as real errors with a stage attached, instead of
 * quietly resolving to empty text.
 */
async function extractTextFromImage(imageBuffer) {
  console.log(`[ocr] Starting OCR on a ${imageBuffer.length}-byte image`);

  let worker;
  try {
    worker = await createWorker('eng', 1, {
      cachePath: os.tmpdir(),
      logger: (m) => {
        if (m.status) console.log(`[ocr] ${m.status} (${Math.round((m.progress || 0) * 100)}%)`);
      },
      errorHandler: (err) => console.error('[ocr] worker error handler:', err),
    });
  } catch (err) {
    console.error('[ocr] Failed to initialize Tesseract worker:', err);
    throw new Error(`OCR worker failed to start: ${err.message}`);
  }

  try {
    const { data } = await worker.recognize(imageBuffer);
    console.log(`[ocr] Recognition complete: ${data.text.length} characters, confidence ${data.confidence}`);
    return data.text;
  } catch (err) {
    console.error('[ocr] Recognition failed:', err);
    throw new Error(`OCR recognition failed: ${err.message}`);
  } finally {
    try {
      await worker.terminate();
    } catch (err) {
      console.error('[ocr] Failed to terminate worker cleanly:', err.message);
    }
  }
}

module.exports = { extractTextFromImage };
