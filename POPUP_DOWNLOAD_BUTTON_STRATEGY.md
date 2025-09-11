# "Download" Button Strategy (Popup Modal)

## 🎯 **Goal**
To reliably find and click the "Download" button located inside a popup modal on PriceLabs.

## ❗️ **Challenge**
This button is particularly tricky because there can be multiple buttons containing the word "download" on the page (e.g., "Download Prices," "Download as CSV"), and it appears within a dynamic modal.

## ✅ **Successful Solution**
The solution is a multi-strategy approach that prioritizes finding the *correct* modal first and then using an **exact text match** to find the button within it.

### **Strategy 1: Highest Z-Index Modal Detection (Priority)**
This is the key to success. The script identifies the correct, active popup by treating it as the modal with the highest `z-index`.

1.  **Find All Modals:** The script first compiles a comprehensive list of all potential modal containers on the page using a wide array of selectors (`[role="dialog"]`, `.modal`, `[class*="popup"]`, etc.).
2.  **Filter by Content & Z-Index:** It then iterates through this list to find the best candidate:
    *   It ignores any modal that is not visible.
    *   It ignores any modal that does **not** contain a button with the word "download" in its text.
    *   From the remaining candidates, it selects the one with the highest `z-index`.

```typescript
let topModal: Element | null = null;
let highestZIndex = -1;

for (const modal of modalContainers) {
    const isVisible = (modal as HTMLElement).offsetParent !== null;
    if (!isVisible) continue;

    const zIndex = parseInt(window.getComputedStyle(modal as HTMLElement).zIndex) || 0;
    
    const downloadButtons = Array.from(modal.querySelectorAll('button')).filter(btn => 
        btn.textContent?.trim().toLowerCase().includes('download')
    );

    if (downloadButtons.length > 0 && zIndex > highestZIndex) {
        highestZIndex = zIndex;
        topModal = modal;
    }
}
```

3.  **Click Button in Top Modal (Exact Match):** Once the `topModal` is identified, the script searches *only within that element* for a button with the **exact text `"download"`** and clicks it. This is crucial for avoiding other "download" buttons.

### **Strategy 2: Fallback Page-Wide Search (Exact Match)**
If the modal detection strategy fails, the script falls back to a page-wide search for any visible button with the **exact text `"download"`**.

## 📊 **Key Success Factors**
- **Z-Index Priority:** Correctly isolates the active popup from background overlays or hidden modals.
- **Content-First Filtering:** Ensures that the script never selects a modal that doesn't contain a download button.
- **Exact Text Match:** Prevents the script from clicking the wrong button (e.g., "Download Prices").
- **Fallback Safety:** A simple, page-wide search provides a safety net if the primary modal logic fails.

## 🚨 **Troubleshooting**
The script includes detailed logging, showing:
- The total number of modal containers found.
- The `z-index`, visibility, and download button count for each modal being checked.
- Which modal was selected as the `topModal`.
- Confirmation of the final button click.
This provides a clear trail to diagnose any failures.
