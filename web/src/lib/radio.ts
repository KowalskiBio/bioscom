import { showToast } from "./stores/toast.svelte";

interface RadioStation {
  streamUrl: string;
  stationName: string;
  songName: string;
}

const STATIONS: Record<string, RadioStation> = {
  cechomor: {
    streamUrl: "https://icecast6.play.cz/jihcimbalka128.mp3",
    stationName: "Čechomor Radio",
    songName: "Traditional Czech Fiddle & Folk",
  },
  moravanka: {
    streamUrl: "https://rozhlas.stream/brno.mp3",
    stationName: "Moravanka Brass",
    songName: "Traditional Moravian Brass Band",
  },
};

function widget(): HTMLElement | null {
  return document.getElementById("lab-radio-widget");
}

function audio(): HTMLAudioElement | null {
  return document.getElementById("lab-radio-audio") as HTMLAudioElement | null;
}

export function startLabRadio(station: string): void {
  const w = widget();
  const a = audio();
  if (w === null || a === null) {
    return;
  }
  const info = STATIONS[station];
  if (info === undefined) {
    return;
  }
  a.src = info.streamUrl;
  a.volume = 0.5;
  const stationEl = document.getElementById("radio-station");
  if (stationEl !== null) {
    stationEl.textContent = info.stationName;
  }
  const songEl = w.querySelector(".song-title");
  if (songEl !== null) {
    songEl.textContent = info.songName;
  }
  w.classList.remove("hidden");
  void a
    .play()
    .then(() => {
      w.querySelector(".vinyl-container")?.classList.add("playing");
      const playBtn = document.getElementById("btn-radio-play");
      if (playBtn !== null) {
        playBtn.textContent = "⏸️";
      }
    })
    .catch(() => {
      showToast("Failed to start radio stream", "error");
    });
}

export function toggleRadioPlay(): void {
  const w = widget();
  const a = audio();
  if (w === null || a === null) {
    return;
  }
  if (a.paused) {
    void a
      .play()
      .then(() => {
        w.querySelector(".vinyl-container")?.classList.add("playing");
        const playBtn = document.getElementById("btn-radio-play");
        if (playBtn !== null) {
          playBtn.textContent = "⏸️";
        }
      })
      .catch(() => {
        showToast("Failed to start radio stream", "error");
      });
  } else {
    a.pause();
    w.querySelector(".vinyl-container")?.classList.remove("playing");
    const playBtn = document.getElementById("btn-radio-play");
    if (playBtn !== null) {
      playBtn.textContent = "▶️";
    }
  }
}

export function setRadioVolume(value: string): void {
  const a = audio();
  if (a !== null) {
    a.volume = parseFloat(value) || 0;
  }
}

export function closeLabRadio(): void {
  const w = widget();
  const a = audio();
  if (a !== null) {
    a.pause();
    a.src = "";
  }
  if (w !== null) {
    w.classList.add("hidden");
    w.querySelector(".vinyl-container")?.classList.remove("playing");
  }
}
