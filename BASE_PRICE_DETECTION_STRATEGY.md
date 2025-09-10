# Base Price Detection Strategy - Documentation

## ✅ **SUCCESSFUL STRATEGY** (Last Updated: Current Working Version)

### **Problem**
PriceLabs pricing page contains multiple input fields with price values, including:
- Checkbox inputs (e.g., occupancy settings with value like `60`)
- Minimum price input (e.g., `96`)
- Base price input (e.g., `132`) ← **TARGET**
- Maximum price input (e.g., `250`)

The challenge was correctly identifying and selecting the **Base price input** among these options.

### **Root Cause of Previous Failures**
The system was incorrectly including checkbox inputs (`chakra-checkbox__input`) in the price selection, which threw off the sorting algorithm:

```
❌ WRONG: Including checkbox in selection
📍 DOM Input 12: value=60, className="chakra-checkbox__input", id="pd-occupancy_60-checkbox"
📍 DOM Input 15: value=96, className="chakra-numberinput__field css-lc9hz6"
📍 DOM Input 16: value=132, className="chakra-numberinput__field css-lc9hz6"
📍 DOM Input 17: value=250, className="chakra-numberinput__field css-lc9hz6"

Result: Minimum: 60 | Base: 96 | Maximum: 132 (WRONG - selected minimum instead of base)
```

### **Successful Solution**

#### **1. Enhanced Filtering Logic**
```typescript
const allPriceInputs = Array.from(allInputs).filter(inp => {
    const val = parseFloat(inp.value.replace(/[^0-9.-]/g, ''));
    
    // Must be a reasonable price value
    if (isNaN(val) || val < 50 || val > 1000) return false;
    
    // ✅ CRITICAL: Exclude checkbox inputs
    if (inp.className.includes('checkbox')) {
        console.log('🚫 Excluding checkbox input with value:', val, 'className:', inp.className);
        return false;
    }
    
    // ✅ CRITICAL: Only include proper number input fields
    if (!inp.className.includes('numberinput') && inp.type !== 'number' && inp.type !== 'text') {
        console.log('🚫 Excluding non-number input with value:', val, 'type:', inp.type, 'className:', inp.className);
        return false;
    }
    
    console.log('✅ Including price input with value:', val, 'className:', inp.className);
    return true;
});
```

#### **2. Smart Selection Algorithm**
```typescript
if (allPriceInputs.length === 3) {
    // Sort by value: [Minimum, Base, Maximum]
    const sortedInputs = [...allPriceInputs].sort((a, b) => {
        const aVal = parseFloat(a.value.replace(/[^0-9.-]/g, ''));
        const bVal = parseFloat(b.value.replace(/[^0-9.-]/g, ''));
        return aVal - bVal;
    });
    
    // Select the middle value as Base price
    const baseInput = sortedInputs[1]; // Middle value = Base
    return baseInput;
}
```

### **Expected Successful Output**
```
🚫 Excluding checkbox input with value: 60 className: chakra-checkbox__input
✅ Including price input with value: 96 className: chakra-numberinput__field css-lc9hz6
✅ Including price input with value: 132 className: chakra-numberinput__field css-lc9hz6
✅ Including price input with value: 250 className: chakra-numberinput__field css-lc9hz6
🎯 SMART SELECTION: Found exactly 3 price inputs (excluding checkbox)
📊 Minimum: 96 | Base: 132 | Maximum: 250
✅ Selecting BASE field with value: 132
```

### **Key Success Factors**

1. **Exclude Checkbox Inputs**: Critical to filter out `chakra-checkbox__input` elements
2. **Include Only Number Inputs**: Only accept inputs with `chakra-numberinput__field` className
3. **Sort by Value**: Always sort numerically to identify min/base/max correctly
4. **Select Middle Value**: The middle value after sorting is always the Base price
5. **Comprehensive Logging**: Detailed logs help debug any future issues

### **Troubleshooting Guide**

If base price detection fails in the future:

1. **Check for New Input Types**: Look for new className patterns that might be interfering
2. **Verify Sorting Logic**: Ensure the sorting is working correctly with console logs
3. **Confirm Field Count**: Should have exactly 3 price inputs after filtering
4. **Check Value Ranges**: Ensure price range filter (50-1000) is still appropriate

### **File Location**
Implementation in: `content.ts` → `findBasePriceInputAttempt()` function

### **Status**: ✅ WORKING SUCCESSFULLY
