// extensions/sample-ext.js

export const name = "Sample Extension";
export const version = "1.0.0";
export const description = "This is a test extension for development purposes.";
export const image = "https://via.placeholder.com/300x150?text=Sample+Extension";

// Called when the extension is enabled or registered
export function register() {
  console.log("[Sample Extension] Registered and active!");
}
