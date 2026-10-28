// Push-сповіщення для «The Logistics · Доставка».
// Працює на тарифі Blaze (Cloud Functions). Розгортання: firebase deploy --only functions
const { onValueWritten } = require("firebase-functions/v2/database");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

// Адреса, де опубліковано програму (для іконки та переходу з сповіщення). Приклад: "https://dyadko.web.app/"
const APP_URL = "";

const STATUS = { enroute: "в дорозі", delivered: "доставлено", partial: "доставлено частково", problem: "проблема" };

exports.orderPush = onValueWritten(
  { ref: "/app/orders/{id}", region: "europe-west1", instance: "dostavka-ed553-default-rtdb" },
  async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();
    if (!after) return;

    const db = getDatabase();
    const users = (await db.ref("app/users").get()).val() || {};
    const tokensOf = (pred) =>
      Object.entries(users)
        .filter(([uid, u]) => u && pred(u, uid))
        .flatMap(([uid, u]) => Object.entries(u.fcm || {}).map(([k, v]) => ({ uid, k, token: v && v.token })))
        .filter((t) => t.token);

    const when = `${after.time || ""}${after.timeTo ? "–" + after.timeTo : ""}`;
    const msgs = [];

    // 1) Водію: на нього призначили доставку
    const closed = ["delivered", "partial", "cancelled"].includes(after.status);
    const isReq = (o) => !!o && o.status === "request";
    // 0) Логістам: менеджер створив заявку
    if (isReq(after) && !isReq(before)) {
      tokensOf((u, uid) => ["admin", "user"].includes(u.role) && uid !== after.updatedBy).forEach((t) =>
        msgs.push({ t, title: "Нова заявка на доставку", body: `${after.client || ""} · ${after.addr || ""}${after.createdByName ? " · від " + after.createdByName : ""}` }));
    }
    // 1) Водію: доставку погоджено і призначено на нього
    if (after.driver && !isReq(after) && (!before || before.driver !== after.driver || isReq(before)) && !closed) {
      tokensOf((u) => u.role === "driver" && u.driver === after.driver).forEach((t) =>
        msgs.push({ t, title: "Нова доставка", body: `${after.date} ${when} · ${after.addr || ""} · ${after.client || ""}` }));
    }
    // 2) Логістам: водій змінив статус
    if (before && before.status !== after.status && STATUS[after.status]) {
      const extra = after.status === "problem" && after.problem ? ` · ${after.problem}`
        : after.status === "partial" && after.retItems ? ` · не доставлено: ${after.retItems}` : "";
      tokensOf((u, uid) => ["admin", "user", "manager"].includes(u.role) && uid !== after.updatedBy).forEach((t) =>
        msgs.push({ t, title: `${after.driver || "Водій"}: ${STATUS[after.status]}`, body: `${after.client || ""} · ${after.addr || ""}${extra}` }));
    }
    // 3) Складу: нове замовлення, яке треба зібрати, і повернення, яке везуть назад
    if (!closed && !isReq(after) && (!before || isReq(before))) {
      tokensOf((u) => u.role === "warehouse").forEach((t) =>
        msgs.push({ t, title: "Зібрати замовлення", body: `${after.date} ${when} · ${(after.items || "").split("\n")[0]}` }));
    }
    if (after.retItems && after.retState === "back" && (!before || before.retState !== "back")) {
      tokensOf((u) => u.role === "warehouse").forEach((t) =>
        msgs.push({ t, title: "Повернення на склад", body: `${after.driver || "Водій"} · ${after.retItems}` }));
    }
    if (!msgs.length) return;

    const res = await getMessaging().sendEach(msgs.map((m) => ({
      token: m.t.token,
      notification: { title: m.title, body: m.body },
      webpush: {
        notification: { tag: `order-${event.params.id}`, renotify: true, ...(APP_URL ? { icon: APP_URL + "icon-192.png" } : {}) },
        ...(APP_URL ? { fcmOptions: { link: APP_URL } } : {})
      }
    })));

    // прибираємо токени пристроїв, які більше не отримують сповіщення
    const dead = {};
    res.responses.forEach((r, i) => {
      const code = (r.error && r.error.code) || "";
      if (!r.success && /registration-token-not-registered|invalid-registration-token/.test(code)) {
        dead[`app/users/${msgs[i].t.uid}/fcm/${msgs[i].t.k}`] = null;
      }
    });
    if (Object.keys(dead).length) await db.ref().update(dead);
  }
);
