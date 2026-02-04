const fs = require("fs");

// Read the Base64 string from file
const base64Data = fs.readFileSync("pdf-base64.txt", "utf8");

// Decode Base64 to buffer
const buffer = Buffer.from(base64Data, "base64");

// Write buffer to PDF file
fs.writeFileSync("decoded-test.pdf", buffer);

console.log("PDF decoded successfully");
console.log("File saved as decoded-test.pdf");