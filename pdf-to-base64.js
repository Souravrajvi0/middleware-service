const fs = require("fs");

// Get PDF path from command line argument, or use default
const pdfPath = process.argv[2] || "C:/Users/DELL/Desktop/TestPdf.pdf";

// Read PDF as binary
const buffer = fs.readFileSync(pdfPath);

// Convert to Base64
const base64 = buffer.toString("base64");

// Write to file
fs.writeFileSync("pdf-base64.txt", base64);

console.log("Base64 generated successfully");
console.log("Length:", base64.length);
console.log("Output saved to pdf-base64.txt");
