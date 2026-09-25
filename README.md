# 🧩 Technical Assessment: Parcel Routing System

## Overview

You are a developer at a parcel delivery company responsible for modernizing an internal parcel routing system.

The system processes parcels and routes them to different departments based on business rules.

The company expects the system to:

- Be adaptable to business changes
- Be reliable when failures occur
- Be safe to evolve
- Provide sufficient visibility when something goes wrong
- Demonstrate thoughtful engineering beyond basic coding

You are encouraged to use AI tools during development. However, you must demonstrate ownership of the design and clearly explain your reasoning.

---

## 📦 Core Requirements

### 1. Parcel Routing

Each parcel contains:

- Weight (kg)
- Value (€)
- Destination country
- Optional additional attributes

#### Default Routing Rules

- Up to 1 kg → **Mail Department**
- Up to 10 kg → **Regular Department**
- Over 10 kg → **Heavy Department**
- Parcels with value greater than €1,000 require **Insurance approval** before routing

#### Expectations

- Implement routing logic.
- Make business rules adaptable to change.
- Design the system so that future departments or routing conditions can be added without major refactoring.
- Consider how rule changes could impact system correctness and safety.

> You are not given strict instructions on how to handle configuration safety — your design should account for business risks.

---

### 2. User Interface

Provide a simple interface that allows:

- Entering parcel data
- Uploading batch data (JSON or XML — your choice, justify it)
- Viewing routing outcomes clearly

The interface should:

- Be usable by non-technical operators
- Communicate decisions clearly
- Handle large input files gracefully
- Be responsive (if web-based)

Focus on clarity and usability over visual complexity.

---

### 3. Quality Assurance

- Include automated tests for routing logic.
- Demonstrate how your tests protect against regressions.
- Show how you would introduce a new rule safely.
- Include a small example of feature development from branch to merge.

Also describe how you validate correctness beyond automated tests.

---

### 4. Monitoring & Reliability

Design the system so that if something goes wrong, the team is notified and there is enough information available to investigate, resolve the issue, and detect unusual patterns in parcel routing.

---

### 5. Security

This application will be deployed facing the public internet. Implement appropriate measures to safeguard it.

Consider how you would protect the system against common threats.

#### Requirements

- Implement security measures in your application.
- Be prepared to explain:
  - What additional measures you would implement to secure the system.
  - Why those measures are important.

---

### 6. Debugging

You will be provided with a buggy routing function during the interview.

Be prepared to:

- Identify the issue quickly
- Explain how you reasoned about it
- Fix it cleanly
- Prevent similar issues in the future

---

### 7. AI Usage

You are expected to use AI tools for at least two parts of this assignment.

You must:

- Show the prompts you used
- Explain what you modified and why
- Demonstrate that you understand the generated code
- Reflect on limitations of AI in this context

---

## 📂 Deliverables

- Production-ready application
- You can choose any programming language
- Tests
- Configuration system (if used)
- README including:
  - Architecture decisions
  - Trade-offs
  - AI usage documentation
  - How to extend the system with new routing rules
- Short presentation (10–15 minutes)

---

## 🎤 Interview Expectations

During the interview, you should be able to:

- Demo your system end-to-end
- Modify or extend routing logic live
- Explain design trade-offs
- Explain how your system adapts to business change
- Discuss how failures would be handled
- Walk through your AI-assisted development process

---

## 🧠 What We Are Evaluating

- Engineering judgment
- Adaptability
- System thinking
- Code quality
- UX awareness
- Testing discipline
- Ability to reason about failure
- Responsible use of AI tools

---

This assessment is intentionally open-ended. There is no single correct implementation.
