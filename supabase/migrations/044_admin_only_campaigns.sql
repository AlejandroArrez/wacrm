-- ============================================================
-- 044 · Difusiones, automatizaciones y flujos: solo admin
--
-- Antes, cualquier miembro con rol `agent` (asesor) podía crear,
-- editar y borrar difusiones, automatizaciones y flujos. Esas
-- piezas envían mensajes con permisos del sistema y alcanzan a
-- todos los contactos, lo que rompe el aislamiento de prospectos
-- de la migración 043. A partir de aquí, escribir en esas tablas
-- requiere `admin` u `owner`. Leer sigue igual (cualquier miembro).
--
-- El webhook y los cron usan la service role y no pasan por RLS,
-- así que el envío y el registro de estados no se ven afectados.
-- ============================================================

-- broadcasts
DROP POLICY IF EXISTS broadcasts_insert ON broadcasts;
DROP POLICY IF EXISTS broadcasts_update ON broadcasts;
DROP POLICY IF EXISTS broadcasts_delete ON broadcasts;
CREATE POLICY broadcasts_insert ON broadcasts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));
CREATE POLICY broadcasts_update ON broadcasts FOR UPDATE
  USING (is_account_member(account_id, 'admin'::account_role_enum));
CREATE POLICY broadcasts_delete ON broadcasts FOR DELETE
  USING (is_account_member(account_id, 'admin'::account_role_enum));

DROP POLICY IF EXISTS broadcast_recipients_modify ON broadcast_recipients;
CREATE POLICY broadcast_recipients_modify ON broadcast_recipients FOR ALL
  USING (EXISTS (SELECT 1 FROM broadcasts b
                  WHERE b.id = broadcast_recipients.broadcast_id
                    AND is_account_member(b.account_id, 'admin'::account_role_enum)))
  WITH CHECK (EXISTS (SELECT 1 FROM broadcasts b
                  WHERE b.id = broadcast_recipients.broadcast_id
                    AND is_account_member(b.account_id, 'admin'::account_role_enum)));

-- automations
DROP POLICY IF EXISTS automations_insert ON automations;
DROP POLICY IF EXISTS automations_update ON automations;
DROP POLICY IF EXISTS automations_delete ON automations;
CREATE POLICY automations_insert ON automations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));
CREATE POLICY automations_update ON automations FOR UPDATE
  USING (is_account_member(account_id, 'admin'::account_role_enum));
CREATE POLICY automations_delete ON automations FOR DELETE
  USING (is_account_member(account_id, 'admin'::account_role_enum));

DROP POLICY IF EXISTS automation_steps_modify ON automation_steps;
CREATE POLICY automation_steps_modify ON automation_steps FOR ALL
  USING (EXISTS (SELECT 1 FROM automations a
                  WHERE a.id = automation_steps.automation_id
                    AND is_account_member(a.account_id, 'admin'::account_role_enum)))
  WITH CHECK (EXISTS (SELECT 1 FROM automations a
                  WHERE a.id = automation_steps.automation_id
                    AND is_account_member(a.account_id, 'admin'::account_role_enum)));

-- flows
DROP POLICY IF EXISTS flows_insert ON flows;
DROP POLICY IF EXISTS flows_update ON flows;
DROP POLICY IF EXISTS flows_delete ON flows;
CREATE POLICY flows_insert ON flows FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));
CREATE POLICY flows_update ON flows FOR UPDATE
  USING (is_account_member(account_id, 'admin'::account_role_enum));
CREATE POLICY flows_delete ON flows FOR DELETE
  USING (is_account_member(account_id, 'admin'::account_role_enum));

DROP POLICY IF EXISTS flow_nodes_modify ON flow_nodes;
CREATE POLICY flow_nodes_modify ON flow_nodes FOR ALL
  USING (EXISTS (SELECT 1 FROM flows f
                  WHERE f.id = flow_nodes.flow_id
                    AND is_account_member(f.account_id, 'admin'::account_role_enum)))
  WITH CHECK (EXISTS (SELECT 1 FROM flows f
                  WHERE f.id = flow_nodes.flow_id
                    AND is_account_member(f.account_id, 'admin'::account_role_enum)));
