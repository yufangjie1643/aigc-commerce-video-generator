# Volcengine Ark Video Understanding Notes

Source: https://www.volcengine.com/docs/82379/1895586

Key points for this skill:

- Base URL: `https://ark.cn-beijing.volces.com/api/v3`
- Chat endpoint: `POST /chat/completions`
- Auth: `Authorization: Bearer $ARK_API_KEY`
- Local videos can be sent as Base64 data URLs: `data:video/mp4;base64,<base64>`.
- Official guidance says Base64 is suitable for smaller videos; file size must be no more than 50 MB and request body no more than 64 MB.
- Chat content uses a video block:

```json
{
  "type": "video_url",
  "video_url": {
    "url": "data:video/mp4;base64,...",
    "fps": 1
  }
}
```

- `fps` controls extraction frequency. Default is 1 frame per second. The documented range in Chat API is 0.2 to 5.
- Ark represents video internally as ordered timestamped frames, inserting text timestamps like `[<timestamp> second]` before extracted frames.
- The official examples use `doubao-seed-2-0-lite-260215`; project-specific endpoints may be supplied through `ARK_VIDEO_MODEL`.
