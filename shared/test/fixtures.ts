export const userFixtures = [
  {
    uid: "uid-admin-1",
    email: "admin@test-lab.example",
    name: "Ada Adminová",
    role: "admin",
    groupId: "group-a",
    status: "",
    avatar: null,
  },
  {
    uid: "uid-reader-1",
    email: "reader@test-lab.example",
    name: "Rado Reader",
    role: "reader",
    groupId: "group-a",
  },
  {
    uid: "uid-super-1",
    email: "root@test-lab.example",
    name: "Super Sue",
    role: "superadmin",
    groupId: "group-b",
    avatar: "data:image/png;base64,AA==",
  },
];

export const userWithJunkRoleFixture = {
  uid: "uid-junk-1",
  email: "junk@test-lab.example",
  role: "wizard",
  groupId: "group-a",
};

export const groupFixture = {
  id: "group-a",
  name: "Test Lab",
  joinCode: "BIOS-572",
  created: 1779197448211,
};

export const historyNameUserFixture = {
  timestamp: 1760000000000,
  user: "Žofka Testová",
  action: 'Added chemical "Ethanol" to container "Fridge 1"',
};

export const historyEmailUserFixture = {
  timestamp: 1760000001000,
  user: "legacy.member@muni.cz",
  action: 'Deleted shelf "Shelf 2" from container "Freezer 1"',
};

export const chemicalFixture = {
  id: "chem-1",
  name: "Hydrochloric acid",
  cas: "7647-01-0",
  formula: "HCl",
  quantity: 500,
  unit: "ml",
  concentration: 0.5,
  concUnit: "mol/L",
  position: "A1",
  customPosition: "M4-custom",
  note: "Handle with care",
};

export const chemicalPositionAA1Fixture = {
  id: "chem-aa1",
  name: "Agarose",
  position: "AA1",
  quantity: 2,
  unit: "pcs",
};

export const cabinetShelfFixtures = [
  { id: "shelf-a", name: "Shelf A–D", chemicals: [chemicalFixture] },
  { id: "shelf-b", name: "Shelf E–L", chemicals: [] },
  { id: "shelf-c", name: "Shelf M–P", chemicals: [] },
  { id: "shelf-d", name: "Shelf Q–Z", chemicals: [] },
  { id: "shelf-e", name: "Bottom shelf", chemicals: [] },
];

export const cabinetContainerFixture = {
  id: "cont-cab-1",
  name: "Main Cabinet",
  description: "General chemicals",
  type: "cabinet",
  cabinetMethod: "alphabetical",
  shelves: cabinetShelfFixtures,
};

export const fridgeContainerFixture = {
  id: "cont-fridge-1",
  name: "Fridge 1",
  type: "fridge",
  shelves: [
    { id: "shelf-f1", name: "Shelf 1", chemicals: [] },
    { id: "shelf-f2", name: "Door shelf 1", chemicals: [] },
    { id: "shelf-f3", name: "Drawer 1", chemicals: [] },
  ],
};

export const freezerContainerFixture = {
  id: "cont-freezer-1",
  name: "Freezer 1",
  type: "freezer",
  shelves: [{ id: "shelf-z1", name: "Top Drawer", chemicals: [] }],
};

export const deepfreezerContainerFixture = {
  id: "cont-df-1",
  name: "Deep Freezer",
  type: "deepfreezer",
  rackPositions: { "Rack 1": 5, "Rack 2": 6 },
  shelves: [
    {
      id: "shelf-df-1",
      name: "Rack 1 / Box A",
      rackName: "Rack 1",
      boxName: "Box A",
      parentShelfId: null,
      chemicals: [],
    },
  ],
};

export const sharedContainerFixture = {
  id: "cont-shared-1",
  name: "Shared Freezer",
  type: "freezer",
  ownerGroupId: "group-b",
  ownerGroupName: "MolPat",
  sharedWithGroupIds: ["group-a"],
  shelves: [],
};

export const roomFixture = {
  id: "room-1",
  name: "Cold Room",
  description: "4 °C",
  containers: [fridgeContainerFixture, freezerContainerFixture],
};

export const roomWithoutContainersFixture = {
  id: "room-2",
  name: "Storage",
};

export const assetRoomFixture = { id: "ar-1", name: "Main Hall" };

export const assetFixture = {
  id: "asset-1",
  name: "Centrifuge 5424",
  model: "Eppendorf",
  description: "Benchtop centrifuge",
  barcode: "BS0001",
  barcodeImg: "data:image/svg+xml;base64,PHM=",
  roomId: "ar-1",
};

export const protocolFixture = {
  id: "prot-1",
  title: "50x TAE (1 L)",
  content: "TRIS 242 g (2 M)\n0.5 M EDTA pH 8 100 ml (50 mM)\nglacial CH3COOH 57,1 ml (1 M)",
};

export const noticeReactionFixture = {
  id: "react-1",
  text: "👍",
  timestamp: 1760000003000,
  userId: "uid-reader-1",
  userName: "Rado Reader",
};

export const noticeFixture = {
  id: "notice-1",
  title: "Lab cleanup",
  content: "Please clean the benches on Friday.",
  category: "suggestion",
  authorName: "Žofka Testová",
  authorUid: "uid-admin-1",
  authorLab: "Test Lab",
  timestamp: 1760000002000,
  reactions: [noticeReactionFixture],
};

export const noticeWithKeyedReactionsFixture = {
  ...noticeFixture,
  reactions: { "react-1": noticeReactionFixture },
};

export const bookingFixture = {
  id: "book-1",
  date: "2026-05-21",
  startTime: "09:00",
  endTime: "12:00",
  userId: "uid-admin-1",
  userName: "Ada Adminová",
  labName: "",
  note: "",
};

export const instrumentFixture = {
  id: "inst-1",
  name: "HPLC Agilent 1260",
  description: "High-performance liquid chromatography",
  location: "Room B302, Desk 4",
  contactPerson: "Rado Reader",
  contactEmail: "reader@test-lab.example",
  ownerLabId: "group-a",
  ownerLabName: "Test Lab",
  bookings: [bookingFixture],
};

export const instrumentWithKeyedBookingsFixture = {
  ...instrumentFixture,
  bookings: { "book-1": bookingFixture },
};

export const printCatalogItemFixture = {
  id: "pc-1",
  name: "Stojan na zkumavky",
  description: "Test tube rack",
  category: "Racks & Holders",
  material: "PETG",
  estimatedTime: "5h",
  image: "data:image/png;base64,AA==",
};

export const printRequestFixture = {
  id: "pr-1",
  catalogItemId: "pc-1",
  catalogItemName: "Stojan na zkumavky",
  customDesign: false,
  quantity: 1,
  requestDate: "2026-06-04",
  requestedBy: "Žofka Testová",
  requestedByUid: "uid-admin-1",
  requestedByLabName: "Test Lab",
  status: "rejected",
};

export const frogChallengeFixture = {
  id: "game-1",
  gameType: "frog",
  challengerName: "Ada Adminová",
  challengerUid: "uid-admin-1",
  opponentName: "Rado Reader",
  opponentUid: "uid-reader-1",
  winnerUid: "uid-reader-1",
  status: "completed",
  createdAt: 1760000004000,
  frogRound: { "uid-admin-1": 5, "uid-reader-1": 5 },
  frogScores: { "uid-admin-1": 4, "uid-reader-1": 5 },
  frogStatus: { "uid-admin-1": "completed", "uid-reader-1": "completed" },
};

const chessBackRow = ["r", "n", "b", "q", "k", "b", "", "r"];
const chessPawnRow = ["p", "p", "p", "p", "p", "p", "p", "p"];
const chessEmptyRow = ["", "", "", "", "", "", "", ""];

export const chessChallengeFixture = {
  id: "game-2",
  gameType: "chess",
  challengerName: "Ada Adminová",
  challengerUid: "uid-admin-1",
  opponentName: "Super Sue",
  opponentUid: "uid-super-1",
  status: "active",
  createdAt: 1760000005000,
  turn: "white",
  board: [
    chessBackRow,
    chessPawnRow,
    chessEmptyRow,
    chessEmptyRow,
    chessEmptyRow,
    chessEmptyRow,
    chessPawnRow,
    chessBackRow,
  ],
};

export const backupFixture = {
  id: "-Bk0001",
  timestamp: 1760000099999,
  data: { rooms: [], assets: [], protocols: [] },
};

export const inventoryTreeFixture = {
  rooms: [
    roomFixture,
    {
      id: "room-2",
      name: "Storage",
      containers: [cabinetContainerFixture, deepfreezerContainerFixture, sharedContainerFixture],
    },
  ],
  assetRooms: [assetRoomFixture],
  assets: [assetFixture],
  protocols: [protocolFixture],
  instruments: [instrumentFixture],
  notices: [noticeFixture],
  printCatalog: [printCatalogItemFixture],
  printRequests: [printRequestFixture],
};
