# P11) AI-Powered Restaurant & Menu Intelligence

Restaurant and menu information is unstructured, image-heavy, incomplete, and difficult to search by dishes or preferences.

## Platform Context

This challenge is built around **Tasco Maps**, Vietnam's next-generation digital map platform designed to help users discover places, businesses, services, and mobility experiences.

Tasco Maps aims to provide intelligent search, local discovery, recommendations, navigation, and location-based experiences tailored for Vietnamese users and businesses.

## Platform Resources

This challenge is built on top of the Tasco Maps ecosystem. Participants are encouraged to explore the Tasco Maps application and design solutions that enhance search, discovery, recommendations, AI experiences, and local content rather than replacing the underlying map platform.

Participants are encouraged to build solutions that are integration-ready with the Tasco Maps ecosystem.

## Objective

Design and build an AI-powered platform that automatically collects, enriches, structures, and maintains restaurant and menu information to improve food discovery, local search, and dining experiences within the VETC ecosystem.

Restaurant information is often fragmented, menus are unstructured, images contain valuable but unused information, and food descriptions are inconsistent or incomplete.

The goal is not to build another food delivery platform, but to build an AI engine that enriches restaurant information, understands menus, and improves restaurant discovery, food search, recommendations, and dining experiences.

## Design Principle

The proposed solution should transform unstructured restaurant information into structured, trustworthy, and continuously enriched restaurant POIs and menu knowledge.

Rather than simply displaying restaurant information, the platform should create high-quality restaurant intelligence that powers search, recommendations, AI assistants, and future dining experiences.

## Innovation Guidelines

- Automatically enrich restaurant POIs using AI.
- Extract structured menu information from images and documents.
- Improve restaurant information quality and completeness.
- Recognize food and dishes from images.
- Enable semantic food search and restaurant discovery.
- Generate AI-powered menu summaries and recommendations.
- Demonstrate a realistic path toward production deployment.

## Core Capabilities

- **Restaurant POI Enrichment** — build structured restaurant profiles from multiple information sources.
- **Menu Extraction** — extract menu items, prices, and categories from menus.
- **OCR Processing** — extract text from printed or photographed menus.
- **Dish Recognition** — identify dishes from food images.
- **Food Search** — search restaurants by dishes, ingredients, cuisine, or dining preferences.
- **AI Restaurant Assistant** — answer restaurant and menu-related questions.
- **AI Summary Generation** — generate concise restaurant and menu summaries.
- **Recommendation Engine** — recommend restaurants and dishes based on user preferences.
- **POI Quality Scoring** — evaluate completeness and quality of restaurant information.

## Example User Scenarios

- **Restaurant Discovery** — find restaurants matching user preferences.
- **Food Search** — search by dish, cuisine, or ingredient.
- **Family Dining** — recommend restaurants suitable for families.
- **Dietary Preferences** — find vegetarian, vegan, halal, or gluten-free options.
- **AI Restaurant Assistant** — answer menu and restaurant-related questions.
- **Restaurant Information Enrichment** — automatically improve incomplete restaurant information.

## Expected Output

- Structured restaurant profile.
- Structured digital menu.
- OCR-extracted menu items and prices.
- Dish recognition results.
- AI-generated restaurant summary.
- Review sentiment analysis.
- Key strengths and weaknesses.
- Cuisine classification.
- Recommended dining occasions such as Family, Business, Romantic, Casual, or Fast Food.
- POI Quality Score.
- Personalized restaurant recommendations.

## Expected Deliverables

- Restaurant Intelligence Platform.
- Menu Intelligence Engine with OCR, menu extraction, and menu structuring.
- AI Restaurant Assistant.
- Recommendation Engine.
- Live demonstration of restaurant intelligence capabilities.

## Submission Requirements

- Presentation deck covering problem statement, solution, architecture, business value, and expected impact.
- Live demonstration or recorded video.
- Source code repository.
- README with setup instructions, technical overview, and AI approach.
- Data enrichment workflow.
- OCR and extraction methodology.
- Dish recognition approach.
- Recommendation methodology.
- POI quality evaluation approach.
- Demonstration of restaurant information enrichment, menu OCR and extraction, dish recognition from images, AI-generated restaurant summary, restaurant comparison, personalized recommendation, and AI assistant Q&A.

## Suggested Architecture

- **Data Collection Layer** — collect restaurant information from multiple sources.
- **OCR & AI Extraction Layer** — extract menus, dishes, prices, and structured attributes.
- **Restaurant Intelligence Layer** — generate restaurant profiles, menu knowledge, summaries, cuisine classification, and quality scores.
- **Recommendation Engine** — personalized restaurant and food recommendations.
- **AI Assistant Layer** — conversational restaurant assistant.
- **Integration Layer** — integration with VETC travel and local discovery services.
- **User Interface** — restaurant discovery and AI assistant experience.

## Success Criteria

- Automatic enrichment of restaurant POIs.
- Accurate extraction of menu information using OCR.
- Reliable dish recognition from food images.
- AI-generated restaurant summaries and review insights.
- High-quality restaurant and food recommendations tailored to different user needs.
- AI assistant capable of answering restaurant and menu-related questions using enriched restaurant knowledge.
- High-quality restaurant intelligence suitable for search, food discovery, recommendations, and future dining experiences.
- A scalable and production-ready architecture.

## Provided Resources

- Sample Restaurant POI Dataset with restaurant names, locations, addresses, categories, and basic information.
- Sample Menu Dataset with restaurant menus in image and PDF formats.
- Sample Food Image Dataset for dish recognition.
- Sample Restaurant Reviews for sentiment analysis.
- Developer Documentation.
- Mock APIs for restaurant search and POI APIs.
- Mock Services: sample API responses and testing environment.

## Build Direction

Build a large-scale AI system that collects and enriches restaurant POIs and menu data, standardizes dishes, supports preference-based search, and can use food images to find nearby matching restaurants.
