-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "coins" REAL NOT NULL DEFAULT 0,
    "userNumber" INTEGER NOT NULL,
    "referralCode" TEXT NOT NULL,
    "referredBy" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "imageUrl" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT,
    "aiScore" REAL,
    "critique" TEXT,
    "computeKJ" REAL NOT NULL DEFAULT 0,
    "nsfw" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Photo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "persona" TEXT,
    "modelProvider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "color" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Agent_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HumanRating" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "photoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HumanRating_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HumanRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentRating" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "photoId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "critique" TEXT,
    "computeJoules" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentRating_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentRating_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CoinTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoinTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_userNumber_key" ON "User"("userNumber");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "HumanRating_photoId_userId_key" ON "HumanRating"("photoId", "userId");
