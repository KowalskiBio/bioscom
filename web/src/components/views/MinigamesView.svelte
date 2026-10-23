<script lang="ts">
  import { gameList } from "../../lib/stores/game.svelte";
  import { currentGroup } from "../../lib/stores/currentGroup.svelte";
  import { session } from "../../lib/stores/session.svelte";
  import { api } from "../../lib/api";
  import { showToast } from "../../lib/stores/toast.svelte";
  import { openModal, closeModal } from "../../lib/modal.svelte";
  import { opCreateGame, opChessMove, opFrogAnswer, opFinishGame } from "../../lib/featureOps";
  import { CHESS_INITIAL_BOARD, CHESS_PIECE_MAP, getChessValidMoves, getPieceColor, applyChessMove, type ChessBoard } from "../../lib/chess";

  interface Member {
    uid: string;
    name: string | null;
    role: string;
  }

  interface FrogQuestion {
    correct: { file: string; species: string };
    options: Array<{ file: string; species: string }>;
  }

  let members = $state<Member[]>([]);
  let opponent = $state("");
  let gameType = $state("frog");
  let activeGameId = $state<string | null>(null);
  let chessSelected: [number, number] | null = null;
  let frogQuestion = $state<FrogQuestion | null>(null);

  const uid = $derived(session.user?.uid ?? "");
  const games = $derived(gameList.items);
  const pending = $derived(games.filter((g) => g.status === "pending" && g.opponentUid === uid));
  const active = $derived(games.filter((g) => g.status === "active" && (g.challengerUid === uid || g.opponentUid === uid)));
  const completed = $derived(games.filter((g) => g.status === "completed" && (g.challengerUid === uid || g.opponentUid === uid)));
  const activeGame = $derived(games.find((g) => g.id === activeGameId) ?? null);

  $effect(() => {
    const groupId = currentGroup.groupId;
    if (groupId === null) {
      return;
    }
    void api
      .get<{ members: Member[] }>(`/api/groups/${encodeURIComponent(groupId)}/members`)
      .then((body) => {
        members = body.members.filter((m) => m.uid !== uid);
      })
      .catch(() => {
        members = [];
      });
  });

  const FROG_LIST = [
    { file: "Dendrobates_auratus.jpg", species: "Dendrobates auratus" },
    { file: "Dendrobates_azureus.jpg", species: "Dendrobates azureus" },
    { file: "Dendrobates_leucomelas.jpg", species: "Dendrobates leucomelas" },
    { file: "Dendrobates_tinctorius_citronella.webp", species: "Dendrobates tinctorius citronella" },
    { file: "Dendrobates_tinctorius_nominant.jpg", species: "Dendrobates tinctorius nominant" },
    { file: "Dendrobates_tinctorius_tumucumaque.jpg", species: "Dendrobates tinctorius tumucumaque" },
    { file: "Dendrobates_truncatus.jpg", species: "Dendrobates truncatus" },
    { file: "Excidobates_captivus.jpg", species: "Excidobates captivus" },
    { file: "Excidobates_mysteriosus.jpg", species: "Excidobates mysteriosus" },
    { file: "Oophaga_histrionica.webp", species: "Oophaga histrionica" },
    { file: "Oophaga_pumilio.jpg", species: "Oophaga pumilio" },
    { file: "Oophaga_sylvatica.jpg", species: "Oophaga sylvatica" },
    { file: "Phyllobates_aurotaenia.jpg", species: "Phyllobates aurotaenia" },
    { file: "Phyllobates_bicolor.jpg", species: "Phyllobates bicolor" },
    { file: "Phyllobates_terribillis.jpg", species: "Phyllobates terribillis" },
    { file: "Ranitomeya_fulgurita.jpg", species: "Ranitomeya fulgurita" },
    { file: "pralesnicka-pruhovana-phyllobates-vittatus-2631.jpg", species: "Phyllobates vittatus" },
  ];

  const frogImages = import.meta.glob("../../assets/Capcha/*", { query: "?url", import: "default", eager: true }) as Record<string, string>;
  const frogUrl = (file: string): string => frogImages[`../../assets/Capcha/${file}`] ?? "";

  function startFrogRound(): void {
    const shuffled = [...FROG_LIST].sort(() => Math.random() - 0.5);
    const correct = shuffled[0]!;
    const options = shuffled.slice(0, 4).sort(() => Math.random() - 0.5);
    if (!options.some((o) => o.species === correct.species)) {
      options[Math.floor(Math.random() * 4)] = correct;
    }
    frogQuestion = { correct, options };
  }

  function openGame(gameId: string): void {
    activeGameId = gameId;
    chessSelected = null;
    const game = games.find((g) => g.id === gameId);
    if (game?.gameType === "frog" && game.status === "active") {
      startFrogRound();
    }
  }

  function closeWorkspace(): void {
    activeGameId = null;
  }

  async function sendChallenge(): Promise<void> {
    if (opponent === "") {
      showToast("Select a colleague first", "error");
      return;
    }
    if (await opCreateGame(gameType as "chess" | "frog", opponent)) {
      showToast("Challenge sent!");
    }
  }

  async function acceptChallenge(gameId: string): Promise<void> {
    await api.post(`/api/games/${gameId}/finish`, {});
    openGame(gameId);
  }

  async function handleFrogAnswer(species: string): Promise<void> {
    if (activeGame === null) {
      return;
    }
    const isCorrect = frogQuestion !== null && species === frogQuestion.correct.species;
    const newRound = (activeGame.frogRound?.[uid] ?? 0) + 1;
    const newScore = (activeGame.frogScores?.[uid] ?? 0) + (isCorrect ? 1 : 0);
    await opFrogAnswer(activeGame.id, newRound, newScore);
    if (newRound >= 5) {
      showToast(`Frog quiz complete! Score: ${newScore}/5`);
    } else {
      startFrogRound();
    }
  }

  const chessBoard = $derived.by(() => {
    if (activeGame === null || activeGame.gameType !== "chess") {
      return null;
    }
    return (activeGame.board ?? CHESS_INITIAL_BOARD) as ChessBoard;
  });
  const myColor = $derived(activeGame !== null && activeGame.challengerUid === uid ? "white" : "black");
  const isMyTurn = $derived(activeGame?.turn === myColor);
  const otherName = $derived(activeGame !== null && activeGame.challengerUid === uid ? activeGame.opponentName : activeGame?.challengerName ?? "");
  const validMoves = $derived(
    chessBoard !== null && chessSelected !== null && isMyTurn
      ? getChessValidMoves(chessBoard, chessSelected[0], chessSelected[1], myColor)
      : [],
  );

  async function onSquareClick(r: number, c: number): Promise<void> {
    if (activeGame === null || chessBoard === null || !isMyTurn) {
      return;
    }
    const piece = chessBoard[r]?.[c] ?? "";
    if (chessSelected !== null) {
      const isValid = validMoves.some(([mr, mc]) => mr === r && mc === c);
      if (isValid) {
        const { board, capturedPiece } = applyChessMove(chessBoard, chessSelected, [r, c], myColor);
        const nextTurn = myColor === "white" ? "black" : "white";
        const kingCaptured = capturedPiece.toUpperCase() === "K";
        if (await opChessMove(activeGame.id, board, nextTurn)) {
          chessSelected = null;
          if (kingCaptured) {
            showToast("🏆 You captured the King! You win!");
            activeGameId = null;
          }
        }
        return;
      }
      if (piece !== "" && getPieceColor(piece) === myColor) {
        chessSelected = [r, c];
        return;
      }
      chessSelected = null;
      return;
    }
    if (piece !== "" && getPieceColor(piece) === myColor) {
      chessSelected = [r, c];
    }
  }

  function resign(): void {
    if (activeGame === null) {
      return;
    }
    const gameId = activeGame.id;
    const otherUid = activeGame.challengerUid === uid ? activeGame.opponentUid : activeGame.challengerUid;
    openModal({
      title: "Resign Game",
      bodyHtml: `<p>Are you sure you want to resign? This will count as a loss.</p>`,
      btnText: "Resign",
      onConfirm: async () => {
        if (await opFinishGame(gameId, otherUid ?? undefined)) {
          closeModal();
          showToast("You resigned.");
          activeGameId = null;
        }
      },
    });
  }

  function squareClasses(r: number, c: number): string {
    const isLight = (r + c) % 2 === 0;
    let cls = `chess-square ${isLight ? "light" : "dark"}`;
    if (chessSelected !== null && chessSelected[0] === r && chessSelected[1] === c) {
      cls += " selected";
    }
    if (validMoves.some(([mr, mc]) => mr === r && mc === c)) {
      cls += " valid-move";
      if ((chessBoard?.[r]?.[c] ?? "") !== "") {
        cls += " occupied";
      }
    }
    return cls;
  }
</script>

<div class="minigames-container" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1.5rem;">
    <div class="minigames-panel" style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
        <h2>Challenge a Colleague</h2>
        <div class="form-group">
            <label class="form-label">Select Colleague</label>
            <select class="form-select" id="game-opponent-select" bind:value={opponent}>
                <option value="">-- choose --</option>
                {#each members as member (member.uid)}
                    <option value={member.uid}>{member.name}</option>
                {/each}
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">Select Game</label>
            <select class="form-select" id="game-type-select" bind:value={gameType}>
                <option value="frog">🐸 Frog CAPTCHA Quiz</option>
                <option value="chess">🧬 Biochemical Chess</option>
            </select>
        </div>
        <button class="btn-primary" id="btn-send-game-challenge" style="margin-top: 0.5rem; width: 100%;" onclick={() => void sendChallenge()}>🚀 Send Challenge</button>

        <h2 style="margin-top: 1rem; border-top: 1px solid var(--border-subtle); padding-top: 1rem;">Pending Challenges</h2>
        <div id="game-pending-list" style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 200px; overflow-y: auto;">
            {#each pending as game (game.id)}
                <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:0.5rem 0.75rem;">
                    <span style="font-size:0.85rem;">{game.gameType === "chess" ? "🧬" : "🐸"} from <strong>{game.challengerName}</strong></span>
                    <button class="btn-inline" onclick={() => void acceptChallenge(game.id)}>Accept</button>
                </div>
            {:else}
                <div style="color: var(--text-muted); font-size: 0.85rem;">No pending challenges</div>
            {/each}
        </div>
    </div>

    <div class="minigames-panel" style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
        <h2>Active Matches</h2>
        <div id="game-active-list" style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 250px; overflow-y: auto;">
            {#each active as game (game.id)}
                <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:0.5rem 0.75rem;">
                    <span style="font-size:0.85rem;">{game.gameType === "chess" ? "🧬" : "🐸"} vs <strong>{game.challengerUid === uid ? game.opponentName : game.challengerName}</strong></span>
                    <button class="btn-inline" onclick={() => openGame(game.id)}>Play</button>
                </div>
            {:else}
                <div style="color: var(--text-muted); font-size: 0.85rem;">No active matches</div>
            {/each}
        </div>

        <h2 style="margin-top: 1rem; border-top: 1px solid var(--border-subtle); padding-top: 1rem;">Completed Matches</h2>
        <div id="game-completed-list" style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 200px; overflow-y: auto;">
            {#each completed as game (game.id)}
                <div style="display:flex; justify-content:space-between; border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:0.5rem 0.75rem; font-size:0.85rem;">
                    <span>{game.gameType === "chess" ? "🧬" : "🐸"} vs <strong>{game.challengerUid === uid ? game.opponentName : game.challengerName}</strong></span>
                    <span style={game.winnerUid === uid ? "color: var(--accent-green);" : game.winnerUid ? "color: var(--accent-red);" : "color: var(--text-muted);"}>{game.winnerUid === uid ? "🏆 Won" : game.winnerUid ? "❌ Lost" : "🤝 Draw"}</span>
                </div>
            {:else}
                <div style="color: var(--text-muted); font-size: 0.85rem;">No completed matches</div>
            {/each}
        </div>
    </div>
</div>

{#if activeGame !== null}
    <div id="active-game-workspace" style="background: var(--bg-card); border: 1.5px solid var(--accent-blue); border-radius: var(--radius-lg); padding: 2rem; margin-top: 2rem; box-shadow: 0 4px 20px rgba(59, 130, 246, 0.15);">
        {#if activeGame.gameType === "frog"}
            {@const myRound = activeGame.frogRound?.[uid] ?? 0}
            {@const myScore = activeGame.frogScores?.[uid] ?? 0}
            {#if (activeGame.frogStatus?.[uid] ?? "playing") === "completed"}
                <div style="text-align:center;">
                    <h2>🐸 Frog Quiz Complete!</h2>
                    <p style="font-size:1.2rem;margin:1rem 0;">Your Score: <strong>{myScore}/5</strong></p>
                    <button class="btn-secondary" style="margin-top:1rem;" onclick={closeWorkspace}>Close</button>
                </div>
            {:else}
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                    <h2 style="margin:0;">🐸 Frog CAPTCHA Quiz — Round {myRound + 1}/5</h2>
                    <div style="display:flex;gap:1rem;align-items:center;">
                        <span style="font-weight:600;">Score: {myScore}/5</span>
                        <button class="btn-secondary" style="padding:0.3rem 0.7rem;font-size:0.8rem;" onclick={closeWorkspace}>Close</button>
                    </div>
                </div>
                <div class="quiz-container">
                    {#if frogQuestion !== null}
                        <div style="font-size:0.95rem;color:var(--text-secondary);margin-bottom:0.5rem;">Identify this dart frog species:</div>
                        <img src={frogUrl(frogQuestion.correct.file)} alt="Frog" style="max-width:380px;max-height:280px;border-radius:var(--radius-lg);border:2px solid var(--border-subtle);object-fit:cover;">
                        <div class="quiz-options">
                            {#each frogQuestion.options as option (option.species)}
                                <button class="quiz-option-btn" onclick={() => void handleFrogAnswer(option.species)}>{option.species}</button>
                            {/each}
                        </div>
                    {/if}
                </div>
            {/if}
        {:else if chessBoard !== null}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                <h2 style="margin:0;">🧬 Biochemical Chess vs {otherName}</h2>
                <div style="display:flex;gap:1rem;align-items:center;">
                    {#if isMyTurn}<span style="color:var(--accent-green);font-weight:700;">🟢 Your turn ({myColor})</span>{:else}<span style="color:var(--text-muted);">⏳ Waiting for {otherName}...</span>{/if}
                    <button class="btn-secondary" style="padding:0.3rem 0.7rem;font-size:0.8rem;" onclick={resign}>🏳️ Resign</button>
                    <button class="btn-secondary" style="padding:0.3rem 0.7rem;font-size:0.8rem;" onclick={closeWorkspace}>Close</button>
                </div>
            </div>
            <div style="display:flex;justify-content:center;align-items:center;gap:2rem;">
                <div>
                    <div style="text-align:center;margin-bottom:0.5rem;font-weight:600;font-size:0.85rem;">{myColor === "white" ? "🧬 Synthesis (White)" : "🦠 Pathogens (Black)"}</div>
                    <div class="chess-board" id="chess-board-grid">
                        {#each Array.from({ length: 8 }, (_, ri) => ri) as ri (ri)}
                            {@const r = myColor === "black" ? 7 - ri : ri}
                            {#each Array.from({ length: 8 }, (_, ci) => ci) as ci (ci)}
                                {@const c = myColor === "black" ? 7 - ci : ci}
                                {@const piece = chessBoard[r]?.[c] ?? ""}
                                <div class={squareClasses(r, c)} data-row={r} data-col={c} onclick={() => void onSquareClick(r, c)}>{piece !== "" ? (CHESS_PIECE_MAP[piece] ?? piece) : ""}</div>
                            {/each}
                        {/each}
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-top:0.75rem;">
                        <div style="font-size:0.75rem;color:var(--text-muted);">White: 🧬P 🏭R 🔬N 🧪B ⚗️Q 👨‍🔬K</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);">Black: 🦠p 💊r 🧫n ☣️b ☠️q 🧟k</div>
                    </div>
                </div>
            </div>
        {/if}
    </div>
{/if}
