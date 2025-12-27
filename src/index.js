// src/index.js
import dotenv from "dotenv";
import { Client } from "@notionhq/client";

dotenv.config();

// ---------------------------------------------------------
// ENV
// ---------------------------------------------------------
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const MANAGERS_DB = process.env.MANAGERS_DB;
const PROJECTS_DB = process.env.PROJECTS_DB;

if (!NOTION_TOKEN || !MANAGERS_DB || !PROJECTS_DB) {
  console.error("❌ Missing ENV variables");
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------
async function listAllPages(databaseId) {
  const results = [];
  let cursor;

  while (true) {
    const res = await notion.databases.query({
      database_id: databaseId,
      page_size: 100,
      start_cursor: cursor,
    });

    results.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  return results;
}

function getTitle(page, prop) {
  return page.properties[prop]?.title
    ?.map(t => t.plain_text)
    .join("") || null;
}

function getNumber(page, prop) {
  return page.properties[prop]?.number ?? 0;
}

// ---------------------------------------------------------
// SUM DATABASE NUMBERS
// ---------------------------------------------------------
async function sumDatabase(databaseId, numberProperty) {
  let total = 0;
  let cursor;

  while (true) {
    const res = await notion.databases.query({
      database_id: databaseId,
      page_size: 100,
      start_cursor: cursor,
    });

    for (const page of res.results) {
      total += getNumber(page, numberProperty);
    }

    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  return total;
}

// ---------------------------------------------------------
// UPDATE PROJECT COST IN MAIN DB
// ---------------------------------------------------------
async function updateProjectCost(projectName, totalCost) {
  const res = await notion.databases.query({
    database_id: PROJECTS_DB,
    filter: {
      property: "اسم المشروع",
      title: { equals: projectName },
    },
    page_size: 1,
  });

  if (!res.results.length) return;

  const page = res.results[0];

  await notion.pages.update({
    page_id: page.id,
    properties: {
      "تكاليف المشروع": {
        number: totalCost,
      },
    },
  });

  console.log(`💰 ${projectName} → ${totalCost}`);
}

// ---------------------------------------------------------
// MAIN LOGIC
// ---------------------------------------------------------
async function main() {
  console.log("🚀 Starting Project_Costs calculation");

  const managers = await listAllPages(MANAGERS_DB);

  for (const manager of managers) {
    const managerPageId = manager.id;

    // البحث عن DB "مشاريعك"
    const blocks = await notion.blocks.children.list({
      block_id: managerPageId,
      page_size: 100,
    });

    const projectsDbBlock = blocks.results.find(
      b => b.type === "child_database" && b.child_database?.title === "مشاريعك"
    );

    if (!projectsDbBlock) continue;

    const projects = await listAllPages(projectsDbBlock.id);

    for (const project of projects) {
      const projectName = getTitle(project, "اسم المشروع");
      if (!projectName) continue;

      let freelanceTotal = 0;
      let purchasesTotal = 0;

      // جلب قواعد البيانات داخل المشروع
      const projectBlocks = await notion.blocks.children.list({
        block_id: project.id,
        page_size: 100,
      });

      const freelanceDb = projectBlocks.results.find(
        b =>
          b.type === "child_database" &&
          b.child_database?.title === "فريق الفرعي لانس"
      );

      const purchasesDb = projectBlocks.results.find(
        b =>
          b.type === "child_database" &&
          b.child_database?.title === "المشتريات"
      );

      if (freelanceDb) {
        freelanceTotal = await sumDatabase(
          freelanceDb.id,
          "المبلغ"
        );
      }

      if (purchasesDb) {
        purchasesTotal = await sumDatabase(
          purchasesDb.id,
          "المبلغ بدون ضريبة"
        );
      }

      const totalCost = freelanceTotal + purchasesTotal;

      await updateProjectCost(projectName, totalCost);
    }
  }

  console.log("✅ Project_Costs finished successfully");
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
