# Customizations Page Workflow Documentation

## Overview
This document provides detailed documentation for the PriceLabs Customizations page workflow processing in the Chrome extension. This serves as a reference for debugging and maintenance.

## Workflow Steps (Steps 14-17)

### Step 14: Select Listings Tab
**Function**: `customizationsStep1Listings()`  
**Content Script Message**: `CUSTOMIZATIONS_STEP_1_LISTINGS`  
**Purpose**: Navigate to the "Listings" tab within the customizations interface

#### Implementation Details:
- **Wait Time**: 3 seconds initial page load wait
- **Detection Strategy**: Uses exact text matching for "Listings" tab
- **Selectors Used**:
  ```typescript
  '[role="tab"]', '.tab', '[class*="tab"]', 'button', 'a', 
  '[role="button"]', 'li a', 'li button', 'div[onclick]', 
  'span[onclick]', '[tabindex]', '.nav-item'
  ```

#### Key Success Criteria:
- Element must contain exactly "listings" (case-insensitive)
- Element must be visible (`offsetParent !== null`)
- Element must be enabled (not disabled)

#### Common Issues:
- **Problem**: Clicking wrong element containing "listings" in larger text
- **Solution**: Uses `text?.toLowerCase().trim() === 'listings'` for exact matching
- **Fallback**: Multiple detection strategies with different selectors

---

### Step 15: Select Table View Icon
**Function**: `customizationsStep2TableView()`  
**Content Script Message**: `CUSTOMIZATIONS_STEP_2_TABLE_VIEW`  
**Purpose**: Click the "Table View" icon (9 squares icon) to switch to table layout

#### Implementation Details:
- **Wait Time**: 3 seconds
- **Detection Strategy**: Looks for elements with "table" text or grid-like icons
- **Selectors Used**:
  ```typescript
  'button', 'a', '[role="button"]', 'div[onclick]', 
  'span[onclick]', '[tabindex]', 'svg', '[class*="grid"]', 
  '[class*="table"]', '[title*="table"]', '[aria-label*="table"]'
  ```

#### Success Criteria:
- Element contains "table" in text, title, or aria-label
- Element is visible and enabled
- Often represented by a 3x3 grid icon

---

### Step 16: Download Customizations for All Listings
**Function**: `customizationsStep3DownloadAll()`  
**Content Script Message**: `CUSTOMIZATIONS_STEP_3_DOWNLOAD_ALL`  
**Purpose**: Click the download button to export customizations data

#### Implementation Details:
- **Wait Time**: 3 seconds + 10 seconds post-download wait
- **Detection Strategy**: Two-phase approach looking for download + customizations text
- **Key Text Patterns**:
  - Must contain both "download" AND "customizations"
  - Alternative: "download" AND "all"
  - Case-insensitive matching

#### Success Criteria:
- Element contains required text combinations
- Element is visible and enabled
- **Important**: Includes 10-second wait after clicking for download completion

#### Strategy Implementation:
```typescript
// Strategy 1: Look for "Download" + "Customizations"
const hasDownload = text?.includes('download') || title?.includes('download');
const hasCustomizations = text?.includes('customizations') || title?.includes('customizations');

// Strategy 2: Look for "Download" + "All"  
const hasAll = text?.includes('all') || title?.includes('all');
```

---

### Step 17: Complete Customizations Workflow
**Function**: `customizationsStep4Complete()`  
**Content Script Message**: `CUSTOMIZATIONS_STEP_4_COMPLETE`  
**Purpose**: Finalize customizations processing and prepare for next workflow phase

#### Implementation Details:
- **Wait Time**: 3 seconds
- **Purpose**: Cleanup and state management
- **Workflow Decision Point**: Determines whether to continue to Market Research or stop

---

## URL and Page Context

### Target URL Pattern:
```
https://app.pricelabs.co/customization
```

### Page Validation:
- URL must contain `/customization`
- Content script injection verification
- React component initialization waits (3-5 seconds)

## Error Handling and Debugging

### Common Failure Points:

1. **Listings Tab Not Found**
   - **Symptom**: "Listings tab not found" error
   - **Debug**: Check if page fully loaded, verify exact text matching
   - **Solution**: Ensure 3-second wait, check for React hydration

2. **Table View Icon Missing**
   - **Symptom**: Cannot switch to table layout
   - **Debug**: Look for grid icons, check if already in table view
   - **Solution**: Multiple selector strategies, visual icon detection

3. **Download Button Not Clickable**
   - **Symptom**: Button found but click doesn't trigger download
   - **Debug**: Check element visibility, z-index, and disabled state
   - **Solution**: Enhanced visibility checks, modal context detection

### Debug Logging:
All functions include comprehensive console logging with emojis:
```typescript
console.log('📝 Customizations Step 1: Selecting Listings tab...');
console.log('🔍 Strategy 1: Looking for tab elements with "Listings" text...');
console.log('🎯 FOUND EXACT LISTINGS TAB:', text);
console.log('✅ Clicked Listings tab');
```

## Content Script Message Handlers

### Message Type Registration:
```typescript
case 'CUSTOMIZATIONS_STEP_1_LISTINGS': {
    await customizationsStep1Listings();
    return { type: 'SUCCESS' };
}
case 'CUSTOMIZATIONS_STEP_2_TABLE_VIEW': {
    await customizationsStep2TableView();
    return { type: 'SUCCESS' };
}
case 'CUSTOMIZATIONS_STEP_3_DOWNLOAD_ALL': {
    await customizationsStep3DownloadAll();
    return { type: 'SUCCESS' };
}
case 'CUSTOMIZATIONS_STEP_4_COMPLETE': {
    await customizationsStep4Complete();
    return { type: 'SUCCESS' };
}
```

## Background Script Workflow Management

### Resume Function:
```typescript
async function resumeCustomizationsWorkflow(startStep: number, customizationsOnly?: boolean)
```

### Key Parameters:
- `startStep`: Which step to begin from (typically 14)
- `customizationsOnly`: Boolean flag to stop after customizations or continue to Market Research

### Workflow Control:
```typescript
// Stop after customizations
if (customizationsOnly) {
    updateState({
        status: WorkflowStatus.SUCCESS,
        message: `Customizations workflow completed successfully!`,
    });
    return;
}

// Continue to Market Research (Steps 18-24)
console.log('🔄 Continuing to Market Research workflow...');
```

## Page Navigation and State Management

### Content Script Re-injection:
- Required after page navigation
- Includes tab load waiting
- React component initialization delays

### State Persistence:
- Uses `chrome.storage.local` for workflow state
- Survives page refreshes and navigation
- Cleared on successful completion

## UI Button Configuration

### Customizations Page Buttons:
1. **"Continue Full Workflow"** (Blue)
   - `fromStep: 14`
   - `customizationsOnly: false`
   - Continues to Market Research after customizations

2. **"Resume Customizations Only"** (Green)
   - `fromStep: 14` 
   - `customizationsOnly: true`
   - Stops after customizations complete

### Button Message:
```typescript
chrome.runtime.sendMessage({ 
    type: 'RESUME_WORKFLOW', 
    fromStep: 14, 
    customizationsOnly: boolean 
});
```

## Performance Considerations

### Wait Times:
- **Initial page load**: 3 seconds
- **Between steps**: 3 seconds each
- **Post-download**: 10 seconds (allows download completion)
- **Content script injection**: 3 seconds

### Memory Management:
- Workflow state cleared on completion
- Event listeners properly removed
- No memory leaks in long-running processes

## Testing and Validation

### Manual Testing Steps:
1. Navigate to `https://app.pricelabs.co/customization`
2. Open extension popup
3. Click "Continue Full Workflow" or "Resume Customizations Only"
4. Monitor console logs for step progression
5. Verify each UI interaction occurs correctly
6. Confirm download completion

### Success Indicators:
- All 4 steps complete without errors
- Listings tab is selected
- Table view is activated  
- Download is triggered and completes
- Workflow continues to Market Research (if full workflow)

### Failure Recovery:
- Content script re-injection on connection errors
- Retry mechanisms with exponential backoff
- Clear error messages with actionable instructions
- State persistence allows resuming after interruptions

## Version History and Known Issues

### Current Implementation Status:
- ✅ Exact text matching for Listings tab (prevents wrong element selection)
- ✅ Enhanced download button detection with 10-second wait
- ✅ Robust error handling and logging
- ✅ Workflow continuation to Market Research
- ✅ State persistence across page navigation

### Historical Issues Resolved:
1. **Listings Tab Selection**: Fixed exact matching vs. substring matching
2. **Download Button Detection**: Enhanced with multiple strategies and wait times
3. **Workflow Continuation**: Added Market Research integration
4. **State Management**: Implemented persistent storage

### Maintenance Notes:
- Monitor for PriceLabs UI changes that might affect selectors
- Update selectors if page structure changes
- Maintain wait times based on page performance
- Keep error messages user-friendly and actionable

---

*Last Updated: December 2024*  
*Chrome Extension Version: 1.0.0*  
*Target: PriceLabs Customizations Workflow*
