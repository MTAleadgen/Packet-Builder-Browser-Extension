# "Edit Profile" Button Strategy (Popup Modal)

## 🎯 **Goal**
To reliably find and click the "Edit Profile" button located inside a popup modal on PriceLabs.

## ❗️ **Challenge**
The button is inside a modal that is dynamically rendered, and there may be multiple modal-like elements on the page (e.g., background overlays), making a simple button search unreliable.

## ✅ **Successful Solution**
The solution is a multi-strategy approach that prioritizes finding the *correct* modal first, then searching for the button within it.

### **Strategy 1: Highest Z-Index Modal Detection (Priority)**
This is the key to success. The script identifies the correct, active popup by treating it as the modal with the highest `z-index`.

1.  **Find All Modals:** The script first compiles a comprehensive list of all potential modal containers on the page using a wide array of selectors (`[role="dialog"]`, `.modal`, `[class*="popup"]`, etc.).
2.  **Filter by Content & Z-Index:** It then iterates through this list to find the best candidate:
    *   It ignores any modal that is not visible.
    *   It ignores any modal that does **not** contain a button with the text "edit profile".
    *   From the remaining candidates, it selects the one with the highest `z-index`.

```typescript
let topModal: Element | null = null;
let highestZIndex = -1;

for (const modal of modalContainers) {
    const isVisible = (modal as HTMLElement).offsetParent !== null;
    if (!isVisible) continue;

    const zIndex = parseInt(window.getComputedStyle(modal as HTMLElement).zIndex) || 0;
    
    // Only consider modals that contain the button we're looking for
    const editButtons = Array.from(modal.querySelectorAll('button')).filter(btn => 
        btn.textContent?.trim().toLowerCase().includes('edit profile')
    );

    if (editButtons.length > 0 && zIndex > highestZIndex) {
        highestZIndex = zIndex;
        topModal = modal;
    }
}
```

3.  **Click Button in Top Modal:** Once the `topModal` is identified, the script searches *only within that element* for the button with the exact text `"edit profile"` and clicks it.

### **Strategy 2: Fallback Page-Wide Search**
If, for any reason, the modal detection strategy fails, the script falls back to a simpler page-wide search for any visible button with the exact text `"edit profile"`.

## 📊 **Key Success Factors**
- **Z-Index Priority:** Correctly isolates the active popup from background overlays or hidden modals.
- **Content-First Filtering:** Ensures that the script never selects a modal that doesn't contain the target button, preventing false positives.
- **Robust Modal Selection:** Using a wide range of CSS selectors makes the modal detection resilient to minor UI code changes.
- **Fallback Safety:** A simple, page-wide search provides a safety net if the primary modal logic fails.

## 🚨 **Troubleshooting**
The script includes detailed logging, showing:
- How many modal containers were found.
- The `z-index`, visibility, and button count for each modal being checked.
- Which modal was selected as the `topModal`.
- Confirmation of the button click.
This provides a clear trail to diagnose any failures.
