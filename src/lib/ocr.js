const Tesseract = require('tesseract.js');

/**
 * Runs OCR on an uploaded image buffer (e.g. a lineup poster screenshot)
 * and returns the raw extracted text. This is intentionally NOT trying to
 * be smart about parsing artist names out of the text — lineup posters use
 * all sorts of stylised layouts, so accuracy varies a lot depending on the
 * image. Instead, the extracted text is shown to the user in an editable
 * textarea so they can clean it up before matching artists, rather than
 * silently guessing wrong.
 */
async function extractTextFromImage(imageBuffer) {
  const {
    data: { text },
  } = await Tesseract.recognize(imageBuffer, 'eng', {
    // logger: (m) => console.log(m), // uncomment for progress logs while debugging
  });
  return text;
}

module.exports = { extractTextFromImage };
