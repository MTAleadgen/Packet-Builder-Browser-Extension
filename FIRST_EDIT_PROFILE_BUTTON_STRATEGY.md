# First "Edit Profile" Button Strategy (Main Page)

## 🎯 **Goal**
To reliably find and click the first "Edit Profile" button on the main PriceLabs page after clicking "Edit".

## ✅ **Successful Solution**
The most reliable method is a straightforward, text-based search combined with a visibility check. Since this button is on the main page and not within a complex modal, this approach is both simple and effective.

### **Strategy 1: Visible Text Match**
The script iterates through all `<button>` elements on the page and applies two conditions:
1.  **Exact Text Match:** It checks for a button where the text content, once trimmed and converted to lowercase, is exactly `"edit profile"`.
2.  **Visibility Check:** It verifies the button is currently visible on the page by checking that its `offsetParent` is not `null`.

```typescript
const allButtons = Array.from(document.querySelectorAll('button'));
let foundButton: HTMLElement | null = null;

for (const btn of allButtons) {
    if (btn.textContent?.trim().toLowerCase() === 'edit profile') {
        const isVisible = (btn as HTMLElement).offsetParent !== null;
        if (isVisible) {
            foundButton = btn as HTMLElement;
            break; // Stop after finding the first visible match
        }
    }
}
```

### **Strategy 2: Scroll and Click**
Once the button is found, the script ensures it's clickable by scrolling it into the center of the view and waiting briefly for the scroll to complete before dispatching the click event.

```typescript
if (foundButton) {
    foundButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for scroll
    foundButton.click();
}
```

## 📊 **Key Success Factors**
- **Simplicity:** Avoids overly complex selectors that might break with minor UI changes.
- **Visibility First:** Ensures we don't try to click a button that is hidden or off-screen.
- **Scrolling:** Robustly handles cases where the button might be further down the page.

## 🚨 **Troubleshooting**
If this step fails, the script will automatically log the text content of every single button on the page to the console. This provides immediate, actionable intelligence for debugging, allowing us to see if the button's text has changed or if it's not being rendered at all.

```
❌ "Edit Profile" button not found. Logging all button texts for debugging:
  - Button 0: "Sync Now"
  - Button 1: "Save"
  - Button 2: "Cancel"
  ...
```

