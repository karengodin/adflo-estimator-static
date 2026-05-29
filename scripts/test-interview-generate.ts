// Run with: npx ts-node scripts/test-interview-generate.ts
// Requires the dev server running at localhost:3000

const MESSAGES = [
  { role: "assistant", content: "Welcome! I'm so glad you reached out — AdFlo can really transform the way teams manage orders and workflows, and I love helping new clients figure out the best path forward.\n\nBefore we dive in, I'd love to know who I'm talking to! What's your name, and who do you represent?" },
  { role: "user", content: "My name is Karen and I'm with the Star Tribune." },
  { role: "assistant", content: "Karen, great to meet you! The Star Tribune is such a well-known publication — it's exciting to think about what we can build together with AdFlo.\n\nTo get us started on the right foot, can you tell me a little about your role there? Are you on the sales side, operations, technology, or somewhere else?" },
  { role: "user", content: "I run the advertising operations team." },
  { role: "assistant", content: "That's a perfect vantage point for an AdFlo implementation — ad ops teams are really at the heart of everything we're building around. You see the full picture from order intake all the way through to delivery.\n\nSo give me a sense of the landscape you're working in today. What kinds of advertising products are you managing — are we talking digital, print, audio, a mix of everything?" },
  { role: "user", content: "Yes, we have all kinds of advertising from owned and operated display to DOOH and everything in between." },
  { role: "assistant", content: "Wow, that's quite a diverse portfolio! Owned and operated display, DOOH — I'm guessing there's print in there too given the Tribune's roots, maybe some programmatic, social, email newsletters? I'd love to get a fuller picture of the whole product mix.\n\nAnd roughly speaking, how many distinct ad products are we talking about? Sometimes clients come in with 20, sometimes it's closer to 200 — knowing that range really helps us understand the scope." },
  { role: "user", content: "O&O Display, programmatic display, social, two kinds of email, newletters, search, seo, branded content, ott/ctv, video, podcasts, programmatic audio, native, Web services. We also have a best of product that we sell different products into. That's kind of separate though and not needed until next year." },
  { role: "assistant", content: "That's a really robust product suite, Karen — and it sounds like you've got a nice mix of traditional digital, emerging channels, and some service-based offerings too. I counted about 15 product types there, which is really helpful to know.\n\nAnd I appreciate you flagging the \"Best Of\" product — it's good to know that's on the horizon even if it's phase two. We'll make a note of it so we can design with that in mind.\n\nNow, each of those products likely has its own set of specs, pricing, and details that need to be captured when an order comes in. Do those products tend to have pretty different order forms from one another, or do some of them share a similar structure? For example, I'd imagine programmatic display and O&O display might be fairly similar, but something like branded content or web services probably looks quite different?" },
  { role: "user", content: "That's correct. Most things have start and end dates, targeting, goals, rates, impressions, total cost, etc. But Branded content might include article generation or just publishing. Social has different intake quesions than display, and our web service project is practically billing only, because the fulfullment is all outsourced." },
  { role: "assistant", content: "That makes a lot of sense — and it's really helpful that you can already articulate those differences. It sounds like you've got a good handle on what makes each product unique.\n\nSo it sounds like we're probably looking at somewhere in the range of 8 to 12 distinct product forms when you group similar ones together — display variants might share a form, but social, branded content, web services, and a few others will need their own. We'll want to map that out carefully during discovery.\n\nOne thing I also want to ask about — for products like display, programmatic, OTT/CTV, and audio, are you managing flight-level details? Like, do orders sometimes have multiple flights with different date ranges, budgets, or targeting within a single order?" },
  { role: "user", content: "We hadn't used flights in the past, but it would make life so much easier, so yes, I want to use flights." },
  { role: "assistant", content: "I love that answer! Flights can be a game changer, especially with a product mix like yours where you might have a campaign running across multiple channels with different start dates, budgets, and targeting parameters. It really brings everything together in one clean order.\n\nSo it sounds like flights will be a core part of how you want to structure orders going forward — good to know.\n\nLet me shift gears a little and ask about the people side of things. When an order comes in today, what does that journey look like? Who's touching it, and in what order? I'm curious about your current approval process and where the handoffs happen." },
  { role: "user", content: "Depeneding on the tier of the client, either the salesperson or account manager is putting the order in." },
  { role: "assistant", content: "Got it — so the entry point varies based on client tier, which makes sense. What happens after the order gets entered? Does it go through any kind of approval before it moves into fulfillment, or does it flow pretty directly to your ops team?" },
  { role: "user", content: "We want to respect SLAs and rates. So if the order is placed less than 5 days before the start date, we need that approved. And if it is below rate card, we need that approved too. But if an order goes in with some things ok and others below rate or late, we want the ok things to flow into Ad Ops." },
  { role: "assistant", content: "Oh, that's a really smart way to think about it — conditional routing where the compliant line items move forward without being held up by the exceptions. That's exactly the kind of nuanced workflow AdFlo handles well.\n\nSo it sounds like you need approval triggers based on at least two conditions: timeline proximity to flight start, and pricing relative to rate card. Who are the approvers in those scenarios? Is it a sales manager, a revenue manager — and is it the same person for both types of exceptions, or different people depending on the situation?" },
  { role: "user", content: "Ops manager for the date issue, sales managemeent for the rate" },
  { role: "assistant", content: "That's clean and logical — route to ops management when it's a timing issue, sales management when it's a pricing issue. And I could imagine a scenario where an order has both problems, so it might need both approvals. Is that right, or would one take precedence over the other?" },
  { role: "user", content: "Absolutly it could be both problems. Both approvals need to happen before the work can get done." },
  { role: "assistant", content: "Perfect, that makes complete sense. So we're looking at parallel approval paths that both need to clear before the line item moves into fulfillment — we can absolutely build that.\n\nNow once things do land with your ad ops team, I'm curious how work gets distributed and managed on your end. Do you have specialists who handle specific product types, or is your team more generalist? And are there other teams downstream — like a trafficking team, a creative services group, a billing team — who also need to be part of the workflow?" },
  { role: "user", content: "There is a team of advertising coordinators that gather creative and get that attached to the lines. Then depending on the product, differnt people get it. For owned and operated items like O&O display and newsletters, our campaign managers do that work. For Search and SEO, we have a search team of specialists. For alsmot everything else, we have media buyers." },
  { role: "assistant", content: "That's a really well-structured team — it sounds like you've got clear lanes for who does what, which is great for building out queues in AdFlo. \n\nSo if I'm following the flow correctly, it goes something like: order entry → approval (if needed) → advertising coordinators for creative gathering → then it splits out to campaign managers, search specialists, or media buyers depending on the product type. Is that roughly right?\n\nAnd is there anything that happens after those teams do their work — like a billing or finance step, or a final quality check before a campaign goes live?" },
  { role: "user", content: "Just internal QA/" },
  { role: "assistant", content: "Good to know — so there's a QA step before campaigns go live. Is that QA done within each team, or is there a dedicated QA person or group that reviews everything regardless of product type?" },
  { role: "user", content: "within the team" },
  { role: "assistant", content: "That keeps it nice and clean — each team owns their own quality check before things go live. \n\nSo it sounds like we're looking at roughly four or five distinct queues in AdFlo: the advertising coordinators queue, campaign managers, search specialists, media buyers, and then the approval queues for ops management and sales management. Does that feel about right, or are there other groups I'm missing?" },
  { role: "user", content: "that's probably right" },
  { role: "assistant", content: "Great, that gives us a solid foundation to work from.\n\nNow let me ask about the people who will actually be logging into AdFlo day to day. Do you have a sense of how many users we're talking about across all those teams — sales, account managers, coordinators, campaign managers, search, media buyers, and the managers who are doing approvals?" },
  { role: "user", content: "about 50, 25 sales and 25 ops." },
  { role: "assistant", content: "That's a very manageable number — 50 users with a nice even split between sales and ops. Good to know.\n\nLet me ask about the financial side of things now. You mentioned rate card pricing and approvals for below-rate orders, so I know pricing is important. But do you also need to track things like cost of goods, margins, or pacing against budget? For example, for your programmatic or social products where you might be buying media on behalf of a client, do you need to see what you're spending versus what you're billing?" },
  { role: "user", content: "That would be nice." },
  { role: "assistant", content: "It really is a powerful feature — being able to see your margin at the line item level, especially for products where you're buying media, gives you a much clearer picture of profitability. \n\nWhat about change orders? When a campaign is already running and a client wants to adjust budget, extend dates, or swap out creative — how do you handle that today, and is that something you'd want managed inside AdFlo as well?" },
  { role: "user", content: "They should be able to edit the line, and then that would notify ops to make changes." },
  { role: "assistant", content: "That makes sense — a streamlined change process where edits trigger notifications to the right ops team rather than a separate formal change order process. Simple and practical.\n\nAnd what about pacing — do you need visibility into how campaigns are tracking against their goals mid-flight? Like, if a campaign is supposed to deliver a million impressions but it's only halfway through budget and already at 80% delivery, would you want that flagged somewhere in AdFlo?" },
  { role: "user", content: "yes, flagged and warned" },
  { role: "assistant", content: "Perfect — so pacing alerts and warnings are definitely on the list. That'll be really valuable for your campaign managers and media buyers to stay ahead of delivery issues.\n\nLet me shift to integrations now. AdFlo works best when it's connected to the other systems in your ecosystem. What other platforms are you working with today? I'm thinking things like a CRM, an ad server, a billing system, anything like that?" },
  { role: "user", content: "Just Google Ad Manager and Naviga for biling" },
  { role: "assistant", content: "Good — two integrations is very manageable. Google Ad Manager makes a lot of sense given your O&O display and other digital products, and Naviga is a great billing system that we have experience working with.\n\nFor each of those, do you have a sense of what you'd need the connection to do? For example, with Google Ad Manager, are you thinking AdFlo should push orders into GAM automatically, or more pull reporting data back into AdFlo — or both? And with Naviga, I'm guessing it's primarily pushing billing information over?" },
  { role: "user", content: "you nailed it." },
  { role: "assistant", content: "Great, that simplifies things nicely! Push to GAM for order creation, pull reporting back for pacing and delivery data, and push billing details to Naviga. Those are well-defined integration patterns that we can scope cleanly.\n\nNow let me ask about timing — when are you hoping to go live with AdFlo? And is that a hard deadline, like tied to a contract renewal or a budget cycle, or is it more of a target you're working toward?" },
  { role: "user", content: "I'm looking for the start of Q4" },
  { role: "assistant", content: "Start of Q4 — so October 1st. That's a meaningful deadline. Is that a hard date for you, like there's something driving it on the business side, or is there some flexibility if things get complex?" },
  { role: "user", content: "there is flexibility. My current contract with my vendor is up at the end of the year" },
  { role: "assistant", content: "That's helpful context — so you have a real forcing function with the contract end date, but some breathing room if you need it. October 1st gives you a nice buffer to get settled before that December 31st deadline. Smart planning.\n\nOne more thing I want to ask about — the Star Tribune is a significant media organization. Are you operating as a single business unit, or do you have multiple brands or regional properties that might need to be managed somewhat independently within AdFlo?" },
  { role: "user", content: "Just that best of product and then the main product." },
  { role: "assistant", content: "Got it — so essentially two business units: the core Star Tribune advertising business, and then the \"Best Of\" product. And since Best Of is phase two, we'd be launching with just the main business unit and designing the system to accommodate that second unit when you're ready to bring it on.\n\nKaren, I feel like I've got a really solid picture of what you're looking to build. This has been a great conversation. Before I let you go, is there anything else you think I should know — anything unique about your business or your team that might affect how we approach the implementation?" },
  { role: "user", content: "I think I have everything." },
  { role: "assistant", content: "Wonderful! Karen, this has been a really productive conversation. You clearly have a great handle on your business and what you need — that's going to make the implementation process so much smoother.\n\nHere's a quick summary of what we've captured today:\n\n- **Products**: ~15 product types with roughly 8-12 distinct product forms, plus flights\n- **Workflows**: Conditional approval routing for late orders (ops manager) and below-rate pricing (sales management), with parallel approvals when both apply\n- **Teams & Queues**: Advertising coordinators, campaign managers, search specialists, media buyers, plus approval queues\n- **Users**: ~50 users, split evenly between sales and ops\n- **Financials**: Margin/COGS tracking, pacing alerts, and edit-triggered change notifications\n- **Integrations**: Google Ad Manager (push/pull) and Naviga billing (push)\n- **Timeline**: Target Q4 start, hard deadline end of year\n- **Business Units**: One for launch, Best Of as phase two\n\nWhen you're ready, go ahead and click **\"Finish & Generate\"** to create your implementation workbook and estimate. It's been a pleasure, Karen — the Star Tribune is going to be a fantastic AdFlo client!" },
];

async function main() {
  const url = "http://localhost:3000/api/interview/generate";

  console.log(`\nPOSTing to ${url} with ${MESSAGES.length} messages...\n`);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: MESSAGES }),
  });

  const data = await res.json() as {
    estimatedHours?: number;
    tier?: string;
    clientName?: string;
    sessionId?: string;
    answers?: Record<string, string>;
    estimateAnswers?: Record<string, unknown>;
    error?: string;
  };

  if (!res.ok || data.error) {
    console.error("ERROR:", data.error ?? `HTTP ${res.status}`);
    process.exit(1);
  }

  console.log("=== RESULT ===");
  console.log("clientName    :", data.clientName);
  console.log("estimatedHours:", data.estimatedHours);
  console.log("tier          :", data.tier);
  console.log("sessionId     :", data.sessionId);
  console.log("\n=== EXTRACTED estimateAnswers ===");
  console.log(JSON.stringify(data.estimateAnswers, null, 2));

  console.log("\n=== ANSWERS (question_id → value) ===");
  console.log(JSON.stringify(data.answers, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
