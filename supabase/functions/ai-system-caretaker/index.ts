import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const appOrigin = Deno.env.get('APP_ORIGIN') ?? 'https://boomrider.vercel.app';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-trigger-source',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-1.5-flash';

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'Supabase service configuration missing' }, 503);
    }

    // Authorization Verification
    const authHeader = req.headers.get('Authorization') ?? '';
    let isAuthorizedAdmin = false;

    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (token === serviceRoleKey) {
        isAuthorizedAdmin = true;
      } else {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
          auth: { persistSession: false },
        });
        const { data: { user } } = await userClient.auth.getUser();
        if (user) {
          const { data: isAdmin } = await userClient.rpc('is_admin', { p_user_id: user.id });
          if (isAdmin) isAuthorizedAdmin = true;
        }
      }
    }

    // Cron triggers without auth header check x-trigger-source
    const triggerSource = req.headers.get('x-trigger-source') || 'cron_scheduled';
    if (!isAuthorizedAdmin && triggerSource !== 'cron_scheduled') {
      return json({ error: 'Unauthorized: Admin or Service Role required' }, 401);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // 1. Fetch system health metrics using RPC
    const { data: healthData, error: healthError } = await supabase.rpc('admin_get_system_health');

    if (healthError || !healthData) {
      console.error('[ai-system-caretaker] Health diagnostic failed:', healthError);
      return json({ error: 'System health check failed', details: healthError }, 500);
    }

    const systemStatus = healthData.system_status ?? 'healthy';
    const orderHealth = healthData.order_health ?? {};
    const walletHealth = healthData.wallet_health ?? {};
    const varianceHealth = healthData.variance_health ?? {};

    const unsettledCount = orderHealth.completed_unsettled_count ?? 0;
    const unrefundedCount = orderHealth.cancelled_unrefunded_count ?? 0;
    const negativeWalletCount = walletHealth.negative_wallets_count ?? 0;
    const varianceCount = varianceHealth.wallet_ledger_variance_count ?? 0;

    let reasoningThought = '';
    const actionsTaken: string[] = [];
    const executionResults: Record<string, unknown> = {
      healthData,
      tier1_actions: [],
      tier2_suggestions: [],
    };

    // 2. Autonomous Tier 1 Self-Healing Executions
    if (unsettledCount > 0) {
      const { data: settleRes, error: settleErr } = await supabase.rpc('admin_retry_stuck_order_settlement');
      if (!settleErr && settleRes?.ok) {
        actionsTaken.push(`Auto-settled ${settleRes.settled_count || 0} stuck completed orders`);
        (executionResults.tier1_actions as Record<string, unknown>[]).push({
          type: 'auto_settle_orders',
          res: settleRes,
        });
      }
    }

    if (varianceCount > 0) {
      const { data: reconcileRes, error: reconcileErr } = await supabase.rpc('admin_reconcile_wallet_ledger');
      if (!reconcileErr && reconcileRes?.ok) {
        actionsTaken.push(`Auto-reconciled ${reconcileRes.reconciled_count || 0} wallet-ledger variances`);
        (executionResults.tier1_actions as Record<string, unknown>[]).push({
          type: 'auto_reconcile_wallets',
          res: reconcileRes,
        });
      }
    }

    // 3. Tier 2 Suggestions Creation for Admin Review
    if (negativeWalletCount > 0) {
      const { data: existingSuggestions } = await supabase
        .from('ai_suggested_actions')
        .select('id')
        .eq('action_type', 'audit_negative_wallets')
        .eq('status', 'pending');

      if (!existingSuggestions || existingSuggestions.length === 0) {
        await supabase.from('ai_suggested_actions').insert({
          action_type: 'audit_negative_wallets',
          title: `พบกระเป๋าเงินติดลบจำนวน ${negativeWalletCount} บัญชี`,
          reasoning: `ระบบตรวจพบยอดคงเหลือติดลบ ${negativeWalletCount} บัญชี ควรตรวจสอบรายการย้อนหลังหรือปรับยอดโดยผู้ดูแลระบบ`,
          payload: { negative_wallet_count: negativeWalletCount },
        });
        (executionResults.tier2_suggestions as Record<string, unknown>[]).push({
          type: 'audit_negative_wallets',
          count: negativeWalletCount,
        });
      }
    }

    // 4. Generate AI Analysis Reasoning via Gemini AI (if available)
    if (geminiApiKey) {
      try {
        const prompt = `คุณคือ BoomBot AI - Autonomous System Caretaker Agent สำหรับระบบ BoomRider
โปรดวิเคราะห์รายงานสุขภาพระบบต่อไปนี้อย่างสั้นกระชับ (2-4 ประโยคภาษาไทย) และระบุข้อสรุปเชิงวิเคราะห์:

[รายงานสุขภาพระบบ]
- สถานะระบบ: ${systemStatus}
- ออเดอร์ค้างรอดำเนินการเคลียร์เงิน: ${unsettledCount} รายการ
- ออเดอร์ยกเลิกที่ต้องคืนเงิน: ${unrefundedCount} รายการ
- กระเป๋าเงินติดลบ: ${negativeWalletCount} บัญชี
- ข้อผิดพลาด Wallet/Ledger Variance: ${varianceCount} บัญชี
- การดำเนินการซ่อมแซมอัตโนมัติ (Tier 1): ${actionsTaken.length > 0 ? actionsTaken.join(', ') : 'ไม่มี'}`;

        const aiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(10_000),
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
            }),
          },
        );

        if (aiRes.ok) {
          const aiJson = await aiRes.json();
          const candidateText = aiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidateText) {
            reasoningThought = candidateText.trim();
          }
        }
      } catch (aiErr) {
        console.warn('[ai-system-caretaker] Gemini reasoning generation skipped:', aiErr);
      }
    }

    if (!reasoningThought) {
      if (systemStatus === 'healthy' && actionsTaken.length === 0) {
        reasoningThought = 'ระบบทำงานอยู่ในสถานะสมบูรณ์แบบ (Healthy) ไม่พบข้อผิดพลาดด้านการเงิน ยอดรวมบัญชี หรือออเดอร์ค้างชำระ';
      } else {
        reasoningThought = `ตรวจพบประเด็นสุขภาพระบบ และทำการซ่อมแซมอัตโนมัติ: ${actionsTaken.length > 0 ? actionsTaken.join(' | ') : 'ลงรายการข้อเสนอแนะให้ผู้ดูแลระบบตรวจสอบ'}`;
      }
    }

    // 5. Audit Log Persistence
    const finalHealthStatus = (unsettledCount === 0 && unrefundedCount === 0 && negativeWalletCount === 0 && varianceCount === 0)
      ? 'healthy'
      : (actionsTaken.length > 0 ? 'auto_repaired' : 'warning');

    const actionTakenText = actionsTaken.length > 0 ? actionsTaken.join(', ') : 'No automated action needed';

    const { error: logErr } = await supabase.from('ai_agent_logs').insert({
      trigger_source: triggerSource,
      health_status: finalHealthStatus,
      reasoning_thought: reasoningThought,
      action_taken: actionTakenText,
      execution_result: executionResults,
    });

    if (logErr) {
      console.error('[ai-system-caretaker] Audit log insert failed:', logErr);
    }

    return json({
      ok: true,
      health_status: finalHealthStatus,
      reasoning_thought: reasoningThought,
      actions_taken: actionsTaken,
      execution_result: executionResults,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ai-system-caretaker] ${message}`);
    return json({ error: 'System caretaker execution failed', details: message }, 500);
  }
});
