import fetch from 'node-fetch';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const BOARD_ID = 5094510357;

const COLUMNS = {
  account: 'text_mm2ccwnb',
  linkedinUrl: 'text_mm2c6xwa',
  email: 'text_mm2cv12n',
  contactNumber: 'text_mm2c9sje',
  title: 'text_mm2n574x',
  city: 'text_mm2njwaz',
  country: 'text_mm2n98pn',
  companyWebsite: 'text_mm2na292',
};

async function mondayQuery(query, variables = {}) {
  if (!process.env.MONDAY_API_KEY) {
    throw new Error('MONDAY_API_KEY not found in environment');
  }

  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': process.env.MONDAY_API_KEY,
      'API-Version': '2024-10',
    },
    body: JSON.stringify({ query, variables }),
  });

  const result = await response.json();

  if (result.errors) {
    throw new Error(`Monday.com API error: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}

async function findOrCreateGroup(campaignName) {
  const groupName = (campaignName || 'Dripify Webhook').trim();

  const query = `
    query ($boardId: ID!) {
      boards(ids: [$boardId]) {
        groups {
          id
          title
        }
      }
    }
  `;

  const data = await mondayQuery(query, { boardId: BOARD_ID.toString() });
  const groups = data.boards[0].groups;

  const match = groups.find(g => g.title.toLowerCase() === groupName.toLowerCase());
  if (match) {
    console.log(`[Monday] Group "${match.title}" (id: ${match.id})`);
    return match.id;
  }

  console.log(`[Monday] Group "${groupName}" not found — creating it`);
  const createData = await mondayQuery(
    `mutation ($boardId: ID!, $groupName: String!) {
      create_group(board_id: $boardId, group_name: $groupName) { id title }
    }`,
    { boardId: BOARD_ID.toString(), groupName }
  );

  const created = createData.create_group;
  console.log(`[Monday] Created group "${created.title}" (id: ${created.id})`);
  return created.id;
}

async function findLeadByLinkedInUrl(linkedinUrl) {
  if (!linkedinUrl) return null;

  const safeUrl = linkedinUrl.trim().replace(/\/$/, '');

  const query = `
    query {
      boards(ids: [${BOARD_ID}]) {
        items_page(limit: 5, query_params: {
          rules: [{ column_id: "${COLUMNS.linkedinUrl}", compare_value: ["${safeUrl}"] }]
        }) {
          items {
            id
            name
          }
        }
      }
    }
  `;

  try {
    const data = await mondayQuery(query);
    const items = data.boards[0].items_page.items;
    if (items.length > 0) {
      console.log(`[Monday] Found existing lead: ${items[0].name} (id: ${items[0].id})`);
      return items[0].id;
    }
    return null;
  } catch (err) {
    console.error(`[Monday] LinkedIn URL search failed: ${err.message}`);
    return null;
  }
}

async function createLead(lead, groupId) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.company || 'Unknown';

  const columnValues = {
    [COLUMNS.account]: lead.company || '',
    [COLUMNS.linkedinUrl]: lead.linkedinUrl || '',
    [COLUMNS.email]: lead.email || '',
    [COLUMNS.contactNumber]: lead.phone || '',
    [COLUMNS.title]: lead.jobTitle || '',
    [COLUMNS.city]: lead.city || '',
    [COLUMNS.country]: lead.country || '',
    [COLUMNS.companyWebsite]: lead.website || '',
  };

  const query = `
    mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
      create_item(
        board_id: $boardId,
        group_id: $groupId,
        item_name: $itemName,
        column_values: $columnValues
      ) {
        id
        name
      }
    }
  `;

  const data = await mondayQuery(query, {
    boardId: BOARD_ID.toString(),
    groupId,
    itemName: name,
    columnValues: JSON.stringify(columnValues),
  });

  console.log(`[Monday] Created new lead: ${data.create_item.name} (id: ${data.create_item.id})`);
  return data.create_item.id;
}

export async function findOrCreateLead(lead) {
  // Try to find existing lead by LinkedIn URL
  const existingId = await findLeadByLinkedInUrl(lead.linkedinUrl);
  if (existingId) return existingId;

  // Not found — resolve/create group then create the item
  console.log(`[Monday] Lead not found — creating new item for ${lead.company || 'unknown company'}`);
  const groupId = await findOrCreateGroup(lead.campaignName);
  return createLead(lead, groupId);
}

export async function postProposal(itemId, proposalMarkdown) {
  const query = `
    mutation ($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) {
        id
      }
    }
  `;

  const data = await mondayQuery(query, {
    itemId: itemId.toString(),
    body: proposalMarkdown,
  });

  return data.create_update.id;
}
