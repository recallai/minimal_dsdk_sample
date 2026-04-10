/**
 * viewer.js — Client-side logic for the recording viewer
 *
 * Handles two pages:
 * 1. Recording list (index.html) — fetches Desktop SDK Uploads via /api/recordings
 * 2. Recording detail (recording.html) — fetches /api/recordings/:id and hydrates
 *    media/transcript when upload.recording_id is available
 */

document.addEventListener("DOMContentLoaded", () => {
  const recordingList = document.getElementById("recording-list");
  const recordingVideo = document.getElementById("recording-video");

  if (recordingList) {
    initListPage(recordingList);
  } else if (recordingVideo) {
    initDetailPage(recordingVideo);
  }
});

// ---------------------------------------------------------------------------
// List page
// ---------------------------------------------------------------------------

let listPollTimer = null;

async function initListPage(listEl) {
  await fetchAndRenderList(listEl);
}

async function fetchAndRenderList(listEl) {
  try {
    const res = await fetch("/api/recordings");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const uploads = await res.json();

    listEl.innerHTML = "";

    if (uploads.length === 0) {
      listEl.innerHTML = '<li class="empty">No recordings yet.</li>';
      stopListPolling();
      return;
    }

    let hasInProgress = false;

    uploads.forEach((rec) => {
      const li = document.createElement("li");
      li.className = "recording-item";

      const dateLabel = formatDate(rec.createdAt);

      const statusCode = rec.status?.code || rec.status || "unknown";
      const statusLabelMap = {
        pending: "Pending",
        recording_started: "Recording in progress",
        recording_ended: "Finalizing recording",
        uploading: "Uploading",
        processing: "Processing",
        complete: "Complete",
        failed: "Failed",
      };
      const statusLabel =
        statusLabelMap[statusCode] ||
        statusCode
          .replace(/_/g, " ")
          .replace(/\b\w/g, (char) => char.toUpperCase());
      const title = rec.meetingTitle || `My recording on ${dateLabel}`;
      const inProgress =
        statusCode === "pending" ||
        statusCode === "recording_started" ||
        statusCode === "recording_ended" ||
        statusCode === "uploading" ||
        statusCode === "processing";

      if (inProgress) hasInProgress = true;

      const h2 = document.createElement("h2");
      h2.textContent = title;
      li.appendChild(h2);

      const dateP = document.createElement("p");
      dateP.textContent = dateLabel;
      li.appendChild(dateP);

      if (inProgress) {
        const flavorP = document.createElement("p");
        flavorP.className = "flavor-text";
        flavorP.textContent = "Your recording will be available soon.";
        li.appendChild(flavorP);
      }

      const statusP = document.createElement("p");
      statusP.className = `status status-${statusCode}`;
      if (inProgress) {
        statusP.innerHTML = `<span class="spinner"></span> ${statusLabel}`;
      } else {
        statusP.textContent = statusLabel;
      }
      li.appendChild(statusP);

      li.addEventListener("click", () => {
        window.location.href = `/recording/${rec.id}`;
      });

      listEl.appendChild(li);
    });

    if (hasInProgress) {
      startListPolling(listEl);
    } else {
      stopListPolling();
    }
  } catch (err) {
    console.error("Failed to load uploads:", err);
    listEl.innerHTML = '<li class="error">Failed to load recordings.</li>';
    stopListPolling();
  }
}

function startListPolling(listEl) {
  if (listPollTimer) return;
  listPollTimer = setInterval(() => fetchAndRenderList(listEl), 3000);
}

function stopListPolling() {
  if (listPollTimer) {
    clearInterval(listPollTimer);
    listPollTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Detail page
// ---------------------------------------------------------------------------

let detailPollTimer = null;

async function initDetailPage(videoEl) {
  const titleEl = document.getElementById("recording-title");
  const dateEl = document.getElementById("recording-date");
  const durationEl = document.getElementById("recording-duration");
  const transcriptEl = document.getElementById("transcript");

  const pathParts = window.location.pathname.split("/");
  const recordingId = pathParts[pathParts.length - 1];

  if (!recordingId) {
    transcriptEl.innerHTML = "<p>No recording ID in URL.</p>";
    return;
  }

  await fetchAndRenderDetail(recordingId, videoEl, titleEl, dateEl, durationEl, transcriptEl);
}

async function fetchAndRenderDetail(recordingId, videoEl, titleEl, dateEl, durationEl, transcriptEl) {
  try {
    const res = await fetch(`/api/recordings/${recordingId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const dateLabel = formatDate(data.startedAt || data.createdAt);
    const statusCode = data.status?.code || data.status || "unknown";

    titleEl.textContent = data.meetingTitle || `My recording on ${dateLabel}`;

    if (data.startedAt || data.createdAt) {
      dateEl.textContent = dateLabel;
    }

    if (data.videoUrl) {
      stopDetailPolling();

      videoEl.style.display = "";
      if (videoEl.src !== data.videoUrl) {
        videoEl.src = data.videoUrl;
      }

      videoEl.addEventListener("loadedmetadata", () => {
        if (videoEl.duration) {
          durationEl.textContent = formatDuration(videoEl.duration);
        }
        const t = new URLSearchParams(window.location.search).get("t");
        if (t) videoEl.currentTime = parseFloat(t);
      }, { once: true });

      if (data.transcript && data.transcript.length > 0) {
        transcriptEl.innerHTML = "";

        data.transcript.forEach((segment) => {
          if (!segment.words || segment.words.length === 0) return;

          const div = document.createElement("div");
          div.className = "transcript-segment";

          const startTime = segment.words[0].start_timestamp?.relative || 0;

          div.addEventListener("click", () => {
            videoEl.currentTime = startTime;
          });

          const speakerP = document.createElement("p");
          speakerP.className = "segment-speaker";
          const nameSpan = document.createElement("span");
          nameSpan.textContent = segment.participant?.name || "Unknown";
          const timeSpan = document.createElement("span");
          timeSpan.className = "segment-time";
          timeSpan.textContent = formatTimestamp(startTime);
          speakerP.appendChild(nameSpan);
          speakerP.appendChild(timeSpan);
          div.appendChild(speakerP);

          const textP = document.createElement("p");
          textP.className = "segment-text";
          textP.textContent = segment.words.map((w) => w.text).join(" ");
          div.appendChild(textP);

          transcriptEl.appendChild(div);
        });
      } else {
        transcriptEl.innerHTML = "<p>No transcript available.</p>";
      }
    } else {
      videoEl.style.display = "none";

      const statusLabelMap = {
        pending: "Pending",
        recording_started: "Recording in progress",
        recording_ended: "Finalizing recording",
        uploading: "Uploading",
        processing: "Processing",
      };
      const statusLabel = statusLabelMap[statusCode] || statusCode;

      transcriptEl.innerHTML =
        `<div class="processing-status">` +
        `<div class="processing-spinner"></div>` +
        `<p>Recording is being processed</p>` +
        `<p class="processing-detail">Status: ${statusLabel}</p>` +
        `</div>`;

      startDetailPolling(recordingId, videoEl,
        document.getElementById("recording-title"),
        document.getElementById("recording-date"),
        document.getElementById("recording-duration"),
        transcriptEl);
    }
  } catch (err) {
    console.error("Failed to load recording:", err);
    transcriptEl.innerHTML = "<p>Failed to load recording data.</p>";
    stopDetailPolling();
  }
}

function startDetailPolling(recordingId, videoEl, titleEl, dateEl, durationEl, transcriptEl) {
  if (detailPollTimer) return;
  detailPollTimer = setInterval(
    () => fetchAndRenderDetail(recordingId, videoEl, titleEl, dateEl, durationEl, transcriptEl),
    3000
  );
}

function stopDetailPolling() {
  if (detailPollTimer) {
    clearInterval(detailPollTimer);
    detailPollTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateString) {
  if (!dateString) return "Unknown date";
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimestamp(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours === 0 && minutes === 0) return "Less than a minute";

  const parts = [];
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? "s" : ""}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? "s" : ""}`);
  return parts.join(" ");
}
