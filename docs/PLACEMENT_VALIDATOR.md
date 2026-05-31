# Placement Validator

The validator prevents #1487569 risk before draft creation.

Checks:

- aspect ratio
- resolution
- file size metadata
- video duration metadata
- selected placement
- creative type
- objective
- asset customization need

Default recommended variants:

- Feed: 1080x1350 / 4:5
- Square and carousel: 1080x1080 / 1:1
- Stories/Reels: 1080x1920 / 9:16
- Landscape/link/in-stream: 1200x628 or 1920x1080

If mismatch exists, ad creation is blocked until a compatible variant or placement restriction is selected.
