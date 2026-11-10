# ATTAIN
These are scripts to help ATTAIN lab coordinators manage participant information.
They are intended to be run on client-side within the browser by using a tool like [Tampermonkey](https://www.tampermonkey.net/).

## SUNY ATTAIN Form Warnings
This script lets us make rules that cause specific warnings (orange) or errors (red) to display next to form fields in the participant details page. The current list of rules is:

### missing-ssn 
trigger: "No SSN" box is checked<br />
red box: "Missing SSN - Please double-check with participant!"

### age
trigger: age < 18<br />
red box: "Applicant is under 18."

trigger: age < 19<br />
checks whether applicant has a high school education, then displays either
orange box: "Applicant is under 19, but has <education_level>" or
red box: "Applicant is under 19 - Check for minor status."

trigger: age > 100<br />
orange box: "Applicant is over 100 - Check for age errors."

### high-income
trigger: income > 150000<br />
orange box: "Income is high - did you mean _____ instead?" (auto-calculates based on potential data entry errors)

### likely-tanf
trigger: at least one family member is under 18 and any assistance is checked, but participant category is not TANF<br />
red box: "Participant is likely TANF-eligible. Double-check category!"<br />
Note: this box displays in two places - next to participant's first name and next to category.

## Generate auto-filled TANF PDF
Uses the data from the form to pre-fill a TANF PDF and saves it to your downloads folder.

## Generate RRF
Uses the data from the form and from a prompt to generate an RRF.<br />
Currently only handles Troy location; can possibly be updated to read location from hidden department field.
