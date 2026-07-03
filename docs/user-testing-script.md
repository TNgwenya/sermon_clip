# Sermon Clip User Testing Script

Use this script for a first tester session. Ask the tester to speak aloud what they expected and what felt confusing.

## Setup

- Open the app home page.
- Confirm the Mac media worker is running before testing any render, rebuild, download, or upload flow.
- Use the existing clean test dataset with 8 sermon projects and 85 clips.

## Tasks

1. Open the sermon projects list and pick any project.
   - Pass: the project list loads quickly, the chosen project opens, and no project appears broken or half-created.

2. Play three clip previews from that project.
   - Pass: each clip starts playing without a broken player, blank video, or 404-style error.

3. Open one clip in the review or studio view.
   - Pass: the page loads, the preview is playable, and timing/caption controls are understandable enough to proceed.

4. Approve one clip, then find it in the ready-to-post flow.
   - Pass: the clip moves forward without losing media, preview, caption, or sermon context.

5. Try a media action that depends on the local worker, such as rebuild, retry render, caption rebuild, or final preparation.
   - Pass: if it runs locally, it queues or completes clearly; if on web-only deployment, the message explains that the Mac worker must run ffmpeg/sharp work.

6. Download or prepare one approved clip.
   - Pass: the output is available, named sensibly, and opens as a video file.

7. Visit the Health page.
   - Pass: the tester can tell whether the app is ready, blocked, or needs the local worker.

8. Delete only a disposable test project if one is created during the session.
   - Pass: the app asks for confirmation, deletes the project, removes it from the list, and does not leave visible broken references.

## Questions

- What was the first point where you hesitated?
- Which label or message was unclear?
- Did any preview, download, or worker action feel unreliable?
- Would you trust this workflow with a real sermon after this session?
