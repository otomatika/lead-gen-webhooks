import express from 'express';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { checkICP } from './icp.js';
import { generateProposal } from './proposal.js';
import { findOrCreateLead, postProposal } from './monday.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '.env') });

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

function extractFields(payload) {
  return {
    firstName: payload.first_name || payload.firstName || '',
    lastName: payload.last_name || payload.lastName || '',
    jobTitle: payload.job_title || payload.title || payload.position || '',
    company: payload.company || payload.company_name || payload.companyName || '',
    website: payload.company_website || payload.companyWebsite || payload.website || '',
    linkedinUrl: (
      payload.link ||
      payload.linkedin_public_url || payload.linkedinPublicUrl ||
      payload.linkedin_url || payload.linkedinUrl ||
      payload.linkedin_profile_url || payload.linkedinProfileUrl || ''
    ),
    email: (
      payload.corporate_email || payload.corporateEmail ||
      payload.email_address || payload.email ||
      payload.linkedin_email || payload.linkedinEmail || payload.linkedInEmail || ''
    ),
    phone: payload.phone_number || payload.phoneNumber || payload.phone || '',
    city: payload.city || '',
    country: payload.country || '',
    industry: payload.industry || '',
    campaignName: payload.campaign_name || payload.campaignName || '',
    employeeCount: (
      payload.number_of_company_employees || payload.numberOfCompanyEmployees ||
      payload.employee_count || payload.employeeCount || ''
    ),
  };
}

async function processLead(payload) {
  const lead = extractFields(payload);
  const displayName = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown';
  console.log(`\n[Pipeline] ${displayName} @ ${lead.company || 'Unknown company'}`);

  // 1. Always create/find the lead item in Monday.com
  const itemId = await findOrCreateLead(lead);

  // 2. ICP check (Claude fetches the website via web_fetch server-side tool)
  const icp = await checkICP({
    companyName: lead.company,
    jobTitle: lead.jobTitle,
    industry: lead.industry,
    employeeCount: lead.employeeCount,
    websiteUrl: lead.website,
  });

  const icpTag = icp.isICP ? '✓ ICP' : '✗ SKIP';
  console.log(`[ICP] ${icpTag} [${icp.confidence}] — ${icp.reasoning}`);

  if (!icp.isICP) return;

  // 4. Generate proposal
  const proposal = await generateProposal({ lead, companyType: icp.companyType, websiteUrl: lead.website });
  console.log(`[Proposal] Generated (${proposal.length} chars)`);

  // 5. Post proposal as update on the item
  await postProposal(itemId, proposal);
  console.log(`[Monday] ✓ Proposal posted to item ${itemId}`);
}

app.post('/webhook/dripify', async (req, res) => {
  console.log('\n━━━ Webhook received ━━━');
  console.log(JSON.stringify(req.body, null, 2));

  try {
    await processLead(req.body);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error(`[Error] ${err.message}`);
    console.error(err.stack);
    // Return 200 so Dripify does not retry — log the error for manual follow-up
    res.json({ status: 'error', message: err.message });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'dripify-webhook' });
});

app.listen(PORT, () => {
  console.log(`\n[Server] Listening on port ${PORT}`);
  console.log(`[Server] POST http://localhost:${PORT}/webhook/dripify`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[Server] WARNING: ANTHROPIC_API_KEY not set');
  }
  if (!process.env.MONDAY_API_KEY) {
    console.warn('[Server] WARNING: MONDAY_API_KEY not set');
  }
});
