from pathlib import Path
from io import BytesIO
import pymupdf as fitz
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors

ROOT = Path(r'D:/Developer Projects/tibay-gym')
SOURCE = Path(r'C:/Users/lunaaa/Downloads/isp-operations-client-review.pdf')
OUT = ROOT / 'output/pdf/isp-operations-client-review-updated.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('Segoe', r'C:/Windows/Fonts/segoeui.ttf'))
pdfmetrics.registerFont(TTFont('SegoeBold', r'C:/Windows/Fonts/segoeuib.ttf'))
pdfmetrics.registerFontFamily('Segoe', normal='Segoe', bold='SegoeBold')
W,H = 595.2756,841.8898
RED = colors.HexColor('#c51c25')
INK = colors.HexColor('#191919')
GRAY = colors.HexColor('#606060')
styles = {
 'body': ParagraphStyle('body',fontName='Segoe',fontSize=10.2,leading=15.2,textColor=INK),
 'small': ParagraphStyle('small',fontName='Segoe',fontSize=8.6,leading=12.8,textColor=GRAY),
 'cell': ParagraphStyle('cell',fontName='Segoe',fontSize=9,leading=12.5,textColor=INK),
 'white': ParagraphStyle('white',fontName='SegoeBold',fontSize=8.5,leading=12,textColor=colors.white),
}

class Page:
 def __init__(self, section, title, intro):
  self.buf=BytesIO(); self.c=canvas.Canvas(self.buf,pagesize=(W,H)); self.y=131
  c=self.c; c.setFillColor(RED); c.rect(0,H-7,W,7,fill=1,stroke=0)
  c.setFillColor(GRAY); c.setFont('SegoeBold',8); c.drawString(48,H-32,'ISP OPERATIONS SYSTEM')
  c.setFont('Segoe',8); c.drawRightString(W-48,H-32,'FEATURES & WORKFLOWS')
  c.setFillColor(RED); c.setFont('SegoeBold',8.6); c.drawString(54,H-74,section)
  c.setFillColor(INK); c.setFont('SegoeBold',25); c.drawString(54,H-112,title)
  self.p(intro); self.y+=16
 def p(self,text,style='body',x=54,width=None):
  p=Paragraph(text,styles[style]); _,h=p.wrap(width or W-108,H)
  p.drawOn(self.c,x,H-self.y-h); self.y+=h+9
 def h(self,text):
  self.c.setFont('SegoeBold',13); self.c.setFillColor(INK)
  self.c.drawString(54,H-self.y-13,text); self.y+=24
 def table(self,heads,rows,widths):
  data=[[Paragraph(str(x),styles['white']) for x in heads]]
  data += [[Paragraph(str(x),styles['cell']) for x in row] for row in rows]
  t=Table(data,colWidths=widths,hAlign='LEFT')
  t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),INK),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f4f4f4')]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),6.5),('BOTTOMPADDING',(0,0),(-1,-1),6.5),('LINEBELOW',(0,1),(-1,-1),0.4,colors.HexColor('#cccccc'))]))
  _,h=t.wrap(W-108,H); t.drawOn(self.c,54,H-self.y-h); self.y+=h+17
 def callout(self,title,text):
  p=Paragraph(text,styles['body']); _,h=p.wrap(W-142,H)
  self.c.setFillColor(colors.HexColor('#f5f5f5')); self.c.rect(54,H-self.y-h-47,W-108,h+47,fill=1,stroke=0)
  self.c.setFillColor(RED); self.c.rect(54,H-self.y-h-47,3,h+47,fill=1,stroke=0)
  self.c.setFont('SegoeBold',8.6); self.c.setFillColor(INK); self.c.drawString(71,H-self.y-17,title)
  p.drawOn(self.c,71,H-self.y-29-h); self.y+=h+62
 def finish(self):
  assert self.y < 785, f'Page too long: {self.y}'
  self.c.save(); self.buf.seek(0); return fitz.open(stream=self.buf.read(),filetype='pdf')

rebate=Page('08 / ADMIN & STATISTICS','Package rebates and profit','Admins can set a rebate amount for each load package. The rebate is the profit earned when a load is completed successfully.')
rebate.h('Set the rebate for each package')
rebate.p('Package settings include the selling price and a fixed rebate amount in PHP. Admin can add or update the rebate separately for each package; different packages may earn different amounts.')
rebate.table(['Example package','Customer pays','Rebate / profit'],[['999 package','PHP 999','PHP 99'],['10 completed loads of this package','PHP 9,990 in sales','PHP 990 in profit']],[180,150,W-438])
rebate.h('Show earnings on the statistics page')
rebate.p('The admin statistics page shows completed load count, total load sales, and total rebate profit. Filter by completion date range, package, or subscriber, and view a package breakdown with its completed loads and earned rebates.')
rebate.h('Count profit after confirmed completion')
rebate.p('A pending request, verified payment, rejected request, or unresolved loading issue does not earn profit yet. Count each completed load once. If a completed load is later reversed through an authorized correction, remove its rebate from the profit total and retain the correction history.')
rebate.h('Preserve the rebate used by each request')
rebate.p('Store the package price and rebate with the request when submitted. Later package changes apply to new requests and do not rewrite past earnings. Rebate-setting changes and corrections remain visible in the super admin change history.')
rebate.callout('THE REBATE IS THE RECORDED PACKAGE PROFIT','For the PHP 999 package with a PHP 99 rebate, statistics records PHP 999 in sales and PHP 99 in rebate profit per completed load. This figure does not deduct other business expenses.')
rebate.p('Proposed detail: Rebate amounts must be zero or more and cannot exceed the package selling price. Confirm which admins may change rebates or view profit statistics.','small')

ticket=Page('09 / CUSTOMER & ADMIN','Support tickets and requests','Customers can open a support ticket from their subscriber view. Admins can review the request, respond, manage its status, and follow it through resolution.')
ticket.h('Customer: open and follow a ticket')
ticket.p('Enter the subscriber account number using the existing customer access method, open Support, enter a subject and describe the issue or request, then submit. The system creates a ticket reference and submission date linked to that subscriber.')
ticket.p('Customers can see tickets linked to their own subscriber account, read admin replies, add follow-up details, and check the current status and status history.')
ticket.h('Admin: review, respond, and update status')
ticket.p('The admin ticket list shows the reference, subscriber, subject, submission date, latest update, and status. Search or filter by subscriber, date, or status. Open the ticket to read the request, reply to the customer, and update its status.')
ticket.table(['Ticket status','Meaning'],[['Open','New request waiting for admin review.'],['In progress','Admin is handling the issue or request.'],['Resolved','Admin has recorded the solution or response.'],['Closed','Admin has finalized the ticket.']],[145,W-253])
ticket.h('Keep the customer informed')
ticket.p('Record replies and status changes with who made them and when. Customers see the updates inside the web app. A ticket that needs an on-site visit can be referenced in a separate installation or repair job created by admin; it does not automatically create or close a job.')
ticket.callout('TICKETS HAVE THEIR OWN WORKFLOW','Support ticket status is separate from job status and load-request status. Admin can manage a customer request even when there is no loading transaction or field visit.')
ticket.p('For review: Confirm whether customers may reopen a resolved or closed ticket. Automatic SMS, email, push alerts, attachments, and service-level timers are outside this ticket scope unless separately agreed.','small')

activity=Page('10 / ADMIN & SUBSCRIBERS','Client status from load history','The system determines each client\'s activity status from their most recent successfully completed load. The dormant period is 60 days.')
activity.table(['Client status','Rule'],[['No Load','The client has no successfully completed load in their recorded history.'],['Active','The client has a completed load and fewer than 60 days have elapsed since their latest completed load.'],['Dormant','60 days or more have elapsed since the client\'s latest completed load.']],[125,W-233])
activity.h('Show activity where admins manage clients')
activity.p('The subscriber list and client profile show the activity status, last completed load date, last package, and days since the last completed load. For clients with no completed load, show No Load and leave the last-load fields empty. Admin can filter the client list by Active, Dormant, or No Load.')
activity.h('Update the status as time and history change')
activity.p('Recalculate status as time passes, so a client becomes Dormant at the 60-day boundary even without a new request. A new completed load updates the last-load date and returns the client to Active. A first completed load changes No Load to Active.')
activity.p('Pending, rejected, payment-verified, or failed loads do not reset the clock. If a completed load is reversed, use the most recent remaining valid completed load; if none remains, show No Load.')
activity.h('Example: the 60-day boundary')
activity.p('A client whose latest completed load was 59 days ago is Active. At 60 elapsed days the client is Dormant. A client who has submitted requests but has never had a successful completed load remains No Load.')
activity.callout('ACTIVITY STATUS DESCRIBES LOADING HISTORY','Dormant and No Load help admins identify clients for follow-up. These labels do not measure internet connectivity or automatically activate, suspend, or disconnect service.')
activity.p('Confirmed in this revision: Dormant begins at 60 days since the latest completed load. For review: Confirm whether historical completed loads will be imported before the system goes live; without those records, existing clients may appear as No Load.','small')

scope=Page('12 / SCOPE & RECORD KEEPING','What this version covers','These boundaries include the newly requested features and help confirm expectations before development begins.')
scope.table(['Included in this version','Requires a separate scope discussion'],[
 ['Single-technician jobs, remarks, materials, admin review, and history.','Team assignments, technician job attachments, GPS, or offline work.'],
 ['Equipment receipts, issuance, usage, returns, and stock checking.','Purchasing/supplier accounting or advanced recovery workflows.'],
 ['Load requests, manual payment checks, external-loading result records, QR codes, and receipt uploads.','Automatic activation/disconnection, connection monitoring, payment gateways, or automatic refunds.'],
 ['Attendance, absence, approved leave, and technician payment records.','Salary calculations, leave balances, deductions, or bank payouts.'],
 ['Admin-created subscribers, account-number-only access, request protection, and client activity labels with a 60-day dormant period.','Customer passwords/OTP, public sign-up, or guaranteed detection of every altered receipt.'],
 ['Package rebate settings and completed-load profit statistics.','Full accounting, expense-based net profit, or automatic rebate payouts.'],
 ['Customer support tickets, admin replies, ticket statuses, and history.','Ticket attachments, service-level timers, or automatic field-job creation.'],
 ['Payables ledger, 3/5-day reminders, and persistent unpaid notices.','Automatic bill payment, recurring bills, or partial payments.'],
 ],[(W-108)/2]*2)
scope.h('Keep records clear and private')
scope.p('Important changes record who made them and when. Approved records keep their history; corrections require an explanation. Staff access is restricted by role, and passwords are not shown in activity records. Payment proofs stay linked to loading records. Technician job photos are not collected.','small')
scope.p('Avoid duplicate requests, repeated stock deductions, duplicate rebate earnings, and conflicting admin processing. Staff still verify external payment and loading results. Receipt retention, request limits, correction permissions, and historical data handling remain for review.','small')
scope.callout('STATUS UPDATES ARE INSIDE THE WEB APP','Loading progress and support ticket updates appear in the customer view. Automatic SMS, email, and push notifications are outside this version.')

review=Page('13 / YOUR REVIEW','Does this match your operations?','Review the feature groups below and identify anything to keep, change, remove, or add. A short explanation or real example is enough.')
review.table(['Feature group','Keep / change / remove'],[[x,''] for x in [
 'Accounts and super admin oversight',
 'Job orders, scheduling, single-technician work, and admin closure',
 'Equipment issuance, usage, returns, and stock checking',
 'Staff profiles, attendance, absence, leave, and payments',
 'Subscriber accounts, packages, payment proofs, and load tracking',
 'Payment QR settings, request protection, and loading processing',
 'Package rebates and profit on the statistics page',
 'Customer support tickets, admin responses, and ticket status',
 'Client activity status: Active, Dormant (60 days), and No Load',
 'Payables ledger and persistent 3/5-day reminders',
 ]],[335,W-443])
review.h('Updated in this revision')
review.p('Added package rebates and profit reporting, customer support tickets, and client status from completed load history. Dormant begins at 60 days. The revised contract price is <b>PHP 47,000</b>, including PHP 2,000 for the additional features.')
review.p('Existing agreed features remain: account-number-only customer access; duplicate receipt checks and request limits; one technician per job; no technician job evidence uploads; admin leave approval; and persistent 3/5-day ledger reminders.','small')
review.h('Details still to confirm')
review.p('Rebate-editing and statistics permissions; ticket reopening; historical load imports; and the payment timing for the additional PHP 2,000. Other open operational details from the earlier pages remain for review.','small')
review.p('Reviewed by: ___________________________  Date: __________________','small')
review.p('Your feedback will update the feature list. The payment schedule follows on pages 15-16. Delivery dates and remaining operational details will be agreed separately.','small')

payment=Page('15 / PAYMENT TERMS','Milestones 5-8 and handover','The remaining stages include customer loading, rebates, activity status, support tickets, payables, and review of the full system.')
payment.table(['Payment','Features / payment point','Amount'],[
 ['Milestone 5<br/>Customer loading','Package and QR settings; package rebate settings; customer selection, payment instructions, receipt upload, request reference, personal history, and repeat-submit protection.','PHP 5,000'],
 ['Milestone 6<br/>Loading and statistics','Payment verification/rejection, processing ownership, external-load results, request protection, and controlled corrections. Completed-load rebate profit statistics and client activity status with the 60-day dormant rule.','PHP 5,000'],
 ['Milestone 7<br/>Tickets and oversight','Customer support tickets, admin replies and statuses; payables ledger with 3/5-day persistent notices and paid history; super-admin-only change history across agreed modules.','PHP 5,000'],
 ['Milestone 8<br/>Checks and handover','Review job, stock, leave, loading, rebate, ticket, client-status, and ledger workflows. Check access, mobile use, duplicates, reminders, profit totals, and the 60-day boundary; resolve agreed-scope issues and provide handover.','PHP 5,000'],
 ],[107,292,W-507])
payment.h('Revised payment summary')
payment.table(['Payment group','Calculation / timing','Amount'],[
 ['Down payment','Existing start-up payment','PHP 5,000'],
 ['Feature milestones','8 x PHP 5,000','PHP 40,000'],
 ['Additional features','Rebates, tickets, and client status; payment timing to be agreed.','PHP 2,000'],
 ['Total contract price','PHP 45,000 + PHP 2,000','PHP 47,000'],
 ],[151,248,W-507])
payment.h('Review before moving forward')
payment.p('Each milestone is demonstrated and reviewed against the agreed scope. Once accepted, its PHP 5,000 payment is due before the next stage; the final milestone payment follows acceptance of milestone 8. The separate PHP 2,000 additional-features payment has no due date set in this draft.','small')
payment.p('The additional PHP 2,000 is included in the PHP 47,000 total. Future scope changes, delivery dates, hosting, domain, and other third-party running costs require separate agreement.','small')

source=fitz.open(SOURCE)
def replace(page,rect,text,size=10.2,bold=False,color=(.10,.10,.10)):
 r=fitz.Rect(rect); page.add_redact_annot(r,fill=(1,1,1)); page.apply_redactions(graphics=0)
 font='NewBold' if bold else 'NewRegular'
 page.insert_font(fontname=font,fontfile=r'C:/Windows/Fonts/segoeuib.ttf' if bold else r'C:/Windows/Fonts/segoeui.ttf')
 spare=page.insert_textbox(fitz.Rect(r.x0,r.y0,r.x1,r.y1+4),text,fontname=font,fontsize=size,lineheight=1.35,color=color)
 assert spare >= 0, (page.number,text,spare)

# Integrate the new features into retained pages rather than leaving conflicting scope text.
replace(source[0],(54,66,400,79),'CLIENT FEATURE REVIEW / VERSION 1.3',8.6,True,(.77,.11,.14))
replace(source[0],(54,216,490,253),'A clearer way to manage field work, equipment,\nsubscriber loading, and customer support.',13)
replace(source[0],(54,269,300,295),'Prepared by Reinier Adrian Luna\nDeveloper | Updated October 29, 2026',9)
replace(source[0],(54,608,542,639),'Pages 2-12 explain accounts, features, and workflows. Page 13 sets the scope; page 14 is the review checklist. Pages 15-16 show the revised PHP 47,000 payment plan.',10)
replace(source[0],(54,646,542,695),'Proposed detail marks a suggested rule for review; For review marks an open choice. This is a review draft, not a signed approval. New features: package rebate profit, support tickets, and client load activity with a 60-day dormant period. Delivery dates will be agreed separately.',9)
replace(source[1],(54,376,542,420),'The super admin can use admin features and oversee jobs, stock, staff, customers, loading, rebate profit statistics, support tickets, client activity, technician payments, leave, and payables.',10.2)
replace(source[1],(54,621,542,663),'The customer loading and support view uses the existing account-number-only access method. Staff accounts use credentials. Technicians see details needed for their assignments. Disabling an account preserves past records.',9)
replace(source[4],(54,576,542,621),'Admin creates each subscriber with an account number, name, contacts, and address. The account-number-only customer view links jobs, loading history, support tickets, and activity status: Active, Dormant (60 days), or No Load. Customers cannot self-register.',10.2)
replace(source[6],(54,130,542,161),'Customers can request load and open support tickets from their subscriber view. Loading requests and tickets are linked to their account; the support workflow is explained on page 10.',10.2)
replace(source[7],(54,204,542,250),'Manage packages with name, price, rebate amount, description, and duration where applicable. Set QR images, recipient details, and payment instructions. Package rebates become profit on the statistics page after completed loading (page 9).',10.2)
replace(source[7],(54,256,542,288),'Unavailable options can be hidden. Each request preserves the package price, rebate, and payment instructions used when submitted; later changes apply to new requests.',10.2)
replace(source[8],(54,66,310,79),'11 / ADMIN LEDGER',8.6,True,(.77,.11,.14))
replace(source[11],(54,66,310,79),'14 / PAYMENT TERMS',8.6,True,(.77,.11,.14))
replace(source[11],(54,130,542,163),'The revised contract price is PHP 47,000, including PHP 2,000 for the additional features. The existing down payment and eight milestones remain; the added fee is listed on page 16.',10.2)
# Preserve table backgrounds by editing the individual amounts only.
replace(source[11],(64,206,170,223),'PHP 47,000',9.5)
replace(source[11],(397,206,470,223),'PHP 42,000',9.5)
replace(source[11],(54,235,542,269),'After the PHP 5,000 down payment, the balance is PHP 42,000: eight PHP 5,000 milestones plus PHP 2,000 for the added features. Timing for the extra PHP 2,000 remains for agreement.',10.2)

result=fitz.open()
for i in range(8): result.insert_pdf(source,from_page=i,to_page=i)
for page in [rebate,ticket,activity]: result.insert_pdf(page.finish())
result.insert_pdf(source,from_page=8,to_page=8)
result.insert_pdf(scope.finish()); result.insert_pdf(review.finish())
result.insert_pdf(source,from_page=11,to_page=11)
result.insert_pdf(payment.finish())
for i,page in enumerate(result):
 replace(page,(45,802,W-45,821),'',8)
 page.insert_font(fontname='Foot',fontfile=r'C:/Windows/Fonts/segoeui.ttf')
 page.draw_line((48,799),(W-48,799),color=(.80,.80,.80),width=.4)
 page.insert_text((48,813),'CLIENT REVIEW DRAFT  |  29 OCT 2026',fontname='Foot',fontsize=7.5,color=(.38,.38,.38))
 page.insert_textbox((490,804,W-48,821),f'{i+1:02d} / {len(result)}',fontname='Foot',fontsize=7.5,align=2,color=(.38,.38,.38))
result.set_metadata({'title':'ISP Operations System - Client Feature Review v1.3','author':'Reinier Adrian Luna','subject':'Updated features, 60-day dormant status, and PHP 47,000 contract price'})
result.save(OUT,garbage=4,deflate=True)
check=fitz.open(OUT)
assert len(check)==16
text='\n'.join(p.get_text() for p in check)
for phrase in ['PHP 47,000','60 days','No Load','PHP 99','Support tickets and requests']:
 assert phrase in text,phrase
assert 'public sign-up, repair' not in text
print(f'Created {OUT} ({len(check)} pages)')
for i,page in enumerate(check):
 pix=page.get_pixmap(matrix=fitz.Matrix(1.1,1.1),alpha=False)
 pix.save(ROOT / f'tmp/pdfs/revised-{i+1:02d}.png')


