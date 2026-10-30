import CaptchaBody from "../components/CaptchaBody.svelte";
import { openModal, closeModal } from "./modal.svelte";
import { showToast } from "./stores/toast.svelte";

const frogs = [
  { file: "Dendrobates_auratus.jpg", name: "Dendrobates auratus" },
  { file: "Dendrobates_azureus.jpg", name: "Dendrobates azureus" },
  { file: "Dendrobates_leucomelas.jpg", name: "Dendrobates leucomelas" },
  { file: "Dendrobates_tinctorius_citronella.webp", name: "Dendrobates tinctorius citronella" },
  { file: "Dendrobates_tinctorius_nominant.jpg", name: "Dendrobates tinctorius nominant" },
  { file: "Dendrobates_tinctorius_tumucumaque.jpg", name: "Dendrobates tinctorius tumucumaque" },
  { file: "Dendrobates_truncatus.jpg", name: "Dendrobates truncatus" },
  { file: "Excidobates_captivus.jpg", name: "Excidobates captivus" },
  { file: "Excidobates_mysteriosus.jpg", name: "Excidobates mysteriosus" },
  { file: "Oophaga_histrionica.webp", name: "Oophaga histrionica" },
  { file: "Oophaga_pumilio.jpg", name: "Oophaga pumilio" },
  { file: "Oophaga_sylvatica.jpg", name: "Oophaga sylvatica" },
  { file: "Phyllobates_aurotaenia.jpg", name: "Phyllobates aurotaenia" },
  { file: "Phyllobates_bicolor.jpg", name: "Phyllobates bicolor" },
  { file: "Phyllobates_terribillis.jpg", name: "Phyllobates terribillis" },
  { file: "Ranitomeya_fulgurita.jpg", name: "Ranitomeya fulgurita" },
  { file: "pralesnicka-pruhovana-phyllobates-vittatus-2631.jpg", name: "Phyllobates vittatus" },
];

const frogImages = import.meta.glob("../assets/Capcha/*", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

function imageUrl(file: string): string {
  return frogImages[`../assets/Capcha/${file}`] ?? "";
}

export function verifyCaptchaAndExecute(action: () => void): void {
  const targetFrog = frogs[Math.floor(Math.random() * frogs.length)]!;
  const options = [targetFrog.name];
  while (options.length < 3) {
    const candidate = frogs[Math.floor(Math.random() * frogs.length)]!.name;
    if (!options.includes(candidate)) {
      options.push(candidate);
    }
  }
  options.sort(() => Math.random() - 0.5);

  openModal({
    title: document.body.dataset.design === "bauhaus" ? "Anti-Bot Check" : "🐸 Anti-Bot Check",
    component: CaptchaBody,
    props: {
      imageUrl: imageUrl(targetFrog.file),
      options,
      onPick: (selected: string) => {
        closeModal();
        if (selected === targetFrog.name) {
          action();
        } else {
          showToast("Wrong frog! Try again.", "error");
        }
      },
    },
    btnText: null,
  });
}
