# Full End-to-End Workflow Sequence & Timings

This document outlines the complete workflow for the extension. Please review and edit the steps, sequence, and wait times below. The extension's logic will be updated to match the final version of this document.

---

Part 1 Initial API & Setup

1. Get Listing Data via API
2. Set Base Price to Max via API
3. Navigate to PriceLabs URL
    Wait Time 4 sec

Part 2 PriceLabs First Sequence

4. Click "Save & Refresh"
    Wait Time 0 sec
5. Click "Sync Now"
    Wait Time 0 sec
6. Click "Edit"
    Wait Time 0 sec
7. Click "Edit Profile" (Main Page)
    Wait Time 0 sec
8. Click "Edit Profile" (Popup)
    Wait Time 0 sec
9. Click "Download" (Popup)
    Wait Time 2 sec
10. Navigate to Customizations Page
    Wait Time 1 sec
11. Click "Listings" Tab
    Wait Time 1 sec
12. Click "Table View"
    Wait Time 1 sec
13. Click "Download All" CSV
    Wait Time 3 sec
14. Navigate to Market Research Page
    Wait Time 2 sec
15. Click "Show Dashboard"
16. Wait for Dashboard to Load
17. Click "Download as PDF"
18. Wait for PDF Download
    Wait Time 120 sec

Part 3 Airbnb Price Tips

19. Navigate to Airbnb URL
    Wait Time 3 sec
20. Click "Price Tips"
21. Zoom Out Browser
    Wait Time 0 sec
22. Extract Price Tips Data
23. Export Data to CSV
24. Restore Original Base Price via API
25. Restore Browser Zoom
26. Navigate Back to PriceLabs
    Wait Time 3 sec

Part 4 PriceLabs Final Sequence

27. Click "Save & Refresh"
    Wait Time 2 sec
28. Click "Sync Now"
    Wait Time 2 sec
29. Click "Edit"
    Wait Time 0 sec
30. Click "Edit Profile" (Main Page)
    Wait Time 0 sec
31. Click "Edit Profile" (Popup)
    Wait Time 0 sec

END Workflow Complete
---

### Troubleshooting Notes
- Step 24 now logs whether the original base price was restored; check the "API restore" entries in persistent logs if the base is not reset.
- The stored base price is normalized before saving and before restoring. If the API returns a non-numeric value, the workflow clears the cached base and logs the missing data to help diagnose the issue.
- Steps 27 and 28 require a 2-second pause after each click to let the PriceLabs UI finish processing before continuing.
