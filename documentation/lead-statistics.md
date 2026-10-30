# Leads statistics

Statistics → Leads summarizes the existing self-reported referral source on official client profiles. It uses the same report styling and theme tokens as the other statistics tabs.

- Each profile counts once, regardless of attendance count. Date filters use `createdAt`, with an inclusive start and exclusive end. Custom end dates include the entire selected day.
- The default period is Last 30 days. All time includes all existing official profiles. Pending registrations and profiles being deleted are excluded.
- Sources follow the registration choices: Ads, Facebook Page, Google Search, Friends, Physical Signage and Others. Missing or unrecognized sources count as Not recorded.
- Percentages use all clients in the selected period, including Not recorded. Top source excludes Not recorded and explicitly handles ties. Rounded percentages may not sum to exactly 100%.
- Member and guest columns reflect current profile type. They do not represent historical conversion rates.
- The Others section displays the recorded free-text answers and their client counts.
- CSV exports the same source totals, percentages and member/guest counts as the table.
- Data loads on first opening Leads. Refresh rereads profiles and updates preset dates; switching tabs preserves the snapshot and filters.

The report measures client acquisition by self-reported channel. Existing data does not distinguish Facebook campaigns, associate generic Ads responses with a platform, or contain spend/ROI information. Deleted profiles no longer contribute to the report.

Validation: unit tests cover unique profiles, creation-date boundaries, current types, deletion guards, missing sources, ties and empty results. DOM tests cover lazy reads, filters, CSV, tab persistence, error recovery and invalid custom ranges. Statistics tab navigation tests cover the new fourth tab.
