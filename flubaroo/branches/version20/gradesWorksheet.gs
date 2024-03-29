// File: graded_worksheet.gas
// Description: 
// This file contains the class to hold the grades worksheet.

// TODO_AJR - Try and get all of the type decisions on the same level. Things like 
// gws type and autogradeon.

// TODO_AJR - Get all of the ScriptProperties into an object to speed things up.
// Check how often they're called.

// TODO_AJR - Look for gws processing done during INIT_TYPE_GRADED_ that might 
// be used.

// TODO_AJR - Questions and percentages not coloured yellow first grading.

// TODO_AJR - Nested functions are acheiving the data hiding, but I'm not
// sure if it's "class" JS or not. Google for "nested class javascript"

// TODO_AJR_BUG - in original code in processGradesSheet() use of question_vals
// as gws property (worked somehow). Fixed but needs passing to DaveA. Showed up 
// when I ran sendEmails with no Grades sheet - should assert on that.

// TODO_AJR_BUG - No frozen row in grades sheet first time graded.

// TODO_AJR - Test for answer key not at row 2 in subm sheet.

// A global flag used to communicate between the submission processing
// and the later stages of the grading that the present submission
// is from a student that has already submitted one. This works as the 
// autograding in a single execution context.
gbl_repeat_subm = false;

// GradesWorksheet class:
// The GradesWorksheet class represents the "Grades" worksheet that will record
// all of the grades. This object obfuscates how that information is written out
// and accessed, making it easier to work with the data in that sheet (both
// during grading, and afterwards). There is only ever a single instance of this 
// object.
// Constructor takes as arguments:
//    spreadsheet: Reference to the entire spreadsheet
//    init_type: Specifies how GradesWorksheet is being initialized:
//               - INIT_TYPE_SUBM: Init from the Student Submissions sheet, during grading.
//               - INIT_TYPE_GRADED_*: Init from the 'Grades' sheet, such as when emailing grades
//
function GradesWorksheet(spreadsheet, init_type)
{
  this.initGWSVars(spreadsheet, init_type);
  
  if (init_type == INIT_TYPE_SUBM)
    {
      this.prepNewGradesSheet(); // possibly remove depending on how autograde progresses.
      
      this.processSubmissionsSheet();
    }
  else // INIT_TYPE_GRADED_*
    {
      if (this.grades_sheet.getLastRow() > 2)
	    {
	      this.processGradesSheet();
	    }
    }
  
  Debug.writeToFieldLogSheet();
}

GradesWorksheet.prototype.initGWSVars = function(spreadsheet, init_type)
{
  this.init_type = init_type;
  
  this.spreadsheet = spreadsheet;
  this.submissions_sheet = getSheetWithSubmissions(this.spreadsheet); 
  this.grades_sheet = getSheetWithGrades(this.spreadsheet);
  
  // TODO_AJR - Better to use an object rather than an associative array.
  
  // Associative array of all graded submissions in the grades sheet.
  // indexed by fingerprint.
  this.graded_submissions = new Array();

  // A read-only list of all fingerprints stored in 
  // this.graded_submissions.
  this.fingerprint_list = null;
  this.fingerprint_list_iterator = 0;

  this.points_possible = 0;
  
  this.num_student_identifiers = 0;
  this.num_gradeable_questions = 0;
  
  this.num_low = 0;
  this.avg_subm_score;
 
  var dp = PropertiesService.getDocumentProperties();  
  this.answer_key_row_num = Number(dp.getProperty(DOC_PROP_ANSWER_KEY_ROW_NUM));
}

GradesWorksheet.prototype.getPointsPossible = function()
{
  return this.points_possible;
}

GradesWorksheet.prototype.getAverageScore = function()
{
  return this.avg_subm_score;
}

GradesWorksheet.prototype.getNumStudentIdentifiers= function()
{
  return this.num_student_identifiers;
}

// TODO_AJR - Would be nice to just be switching on init_type
// rather than assuming the fp has been set up, which it is when the 
// submission sheet is processed.

GradesWorksheet.prototype.getNumGradedSubmissions = function()
{
  var num;

  if (this.fingerprint_list != null && this.fingerprint_list.length > 0)
    {      
      // Whenever possible use the total number of unique 
      // fingerprints.
      
      Debug.info("GradesWorksheet.getNumGradedSubmissions()" + 
                 " - numb subm (fp) = " + this.fingerprint_list.length);
      
      num = this.fingerprint_list.length;
    }
  else
    {
      num = NumGradedSubm.get();
    }

  return num;
}

// addGradedSubmission: Adds a new graded submission. If already exists (same fingerprint), replaces
// the existing one.
GradesWorksheet.prototype.addGradedSubmission = function(fingerprint, gs)
{
  this.graded_submissions[fingerprint] = gs;  
}

GradesWorksheet.prototype.checkForGradedSubmission = function(fingerprint)
{
  return (fingerprint in this.graded_submissions) ? true : false;
}
  
GradesWorksheet.prototype.getGradedSubmissionByFingerprint = function(fingerprint)
{
  if (fingerprint in this.graded_submissions)
    {    
      return this.graded_submissions[fingerprint];
    }
  else
    {
      return null;
    }
}

// getFirstGradedSubmission:
// To make sure we write only the final grades (e.g. counting multiple 
// submissions) we walk through the array of unique student 

// fingerprints.
GradesWorksheet.prototype.getFirstGradedSubmission = function()
{
  // TODO_AJR This creates the whole fingerprint list but only ever 
  // accesses the first value. Can this be split out as "get next"
  // depends on this being called first.
  
  // Put each of the graded submissions into the fingerprint array.
  
  this.fingerprint_list = new Array();
  this.fingerprint_list_iterator = 0;
  
  for (var key in this.graded_submissions)
    {
      this.fingerprint_list.push(key);
    } 

  Debug.info("GradesWorksheet.getFirstGradedSubmission() - Initialised fp list"); 

  Debug.info("GradesWorksheet.getFirstGradedSubmission() - fp list length: " + 
             this.fingerprint_list.length);

  // Return the first submission in the array (extract the first entry 
  // from the array of fingerprints and use this as the key in the 
  // associative array of graded submissions).
  return this.graded_submissions[this.fingerprint_list[0]];
}
  
GradesWorksheet.prototype.getNextGradedSubmission = function()
{
  this.fingerprint_list_iterator++;
  
  if (this.fingerprint_list_iterator < this.fingerprint_list.length)
    {
      return this.graded_submissions[this.fingerprint_list[this.fingerprint_list_iterator]];
    }
  else
   {
     return null;
   }
}  
 
// processSubmissionsSheet:
// Performs the grading of all rows compared to the answer key. 
GradesWorksheet.prototype.processSubmissionsSheet = function()
{
  var dp = PropertiesService.getDocumentProperties();
  
  var func_name = "GradesWorksheet.processSubmissionsSheet() - ";

  // Get the questions
  // -----------------
  
  // Read in the questions asked from the first row and mark the first 
  // value as the timestamp.
  
  var question_vals = getQuestionValsFromSubmissions(this.submissions_sheet);
  
  // Read in the grading options.
  
  var grade_opt_str = dp.getProperty(DOC_PROP_UI_GRADING_OPT);
  
  Debug.assert(grade_opt_str !== null, func_name + "grading options not set");
  
  this.grading_options = grade_opt_str.split(",");
  
  this.processGradingOptions();
  
  // Get the answer key values
  // -------------------------
  
  // Collect the answers from the Answer Key row. Make all lowercase so we're
  // case insentive when comparing to text submissions.
  
  var answer_key_vals = singleRowToArray(this.submissions_sheet,
                                         this.answer_key_row_num,
                                         getNumQuestionsFromSubmissions(this.submissions_sheet));
  
  // Create a copy of the array, not a reference to it.
  
  var answer_key_vals_lc = answer_key_vals.slice(0);  
  
  for (var i = 0; i < answer_key_vals_lc.length; i++)
    {
      if (typeof answer_key_vals_lc[i] == 'string')
        {
          answer_key_vals_lc[i] = strTrim(answer_key_vals_lc[i].toLowerCase());
        }
    }
    
  // TODO_AJR - If, reading in the answer key values, one isn't a string is that
  // a problem?

  // Get the help tips
  // -----------------
  // Collect the help tips if any are present. These will always be in the second
  // row of the form (case insensitive when comparing to text submissions).
  
  var help_tips_vals = getTipsRow(this.submissions_sheet);  
  var help_tips_present = (help_tips_vals !== null) ? true : false;
  Debug.info(func_name + "help_tips_present: " + help_tips_present);
  
  // Get the student's submissions
  // -----------------------------
  //
  // Convert the row data from the submissions sheet into a 'graded submission' object
  // and link it to the preset 'graded worksheet' object in the 'fingerprint' array.
  

  // DAA: This assert was incorectly failing in autograde, which is what ended up in me
  // removing EmptySubmRow class.
  //Debug.assert(numb_rows > MIN_NUM_SUBM_SHEET_ROWS, func_name + "subm row ptr invalid");
  

  var numb_rows = this.submissions_sheet.getLastRow();
  
  // record how many rows we're about to grade. used by autograde logic.
  dp.setProperty(DOC_PROP_LAST_GRADED_ROW_COUNT, numb_rows);
  
  // Skip over the first row with questions in (row_num = 2).
  for (var subm_row_num = 2; subm_row_num <= numb_rows; subm_row_num++)
    {
      Debug.info(func_name + "processing row: " + subm_row_num);
      
      if (subm_row_num === this.answer_key_row_num)
        {
          // No need to include the answer key in the 
          // grades so skip it.
          Debug.info(func_name + "skip answer key");
          continue;
        }
      
      if (subm_row_num === 2 && help_tips_present)
        {
          // Skip over the help tips in the second row.
          Debug.info(func_name + "skip help tips");
          continue;
        }
      
      // Create a new GradedSubmission from this submission.
      var new_graded_subm = new GradedSubmission(this, 
                                                 this.submissions_sheet, 
                                                 this.grades_sheet,
                                                 question_vals, 
                                                 help_tips_present, 
                                                 help_tips_vals,
                                                 this.grading_options, 
                                                 this.points_possible,
                                                 answer_key_vals, 
                                                 answer_key_vals_lc, 
                                                 this.num_student_identifiers,
                                                 subm_row_num,
                                                 INIT_TYPE_SUBM);
                                     
      // Create a fingerprint to uniquely identify this student and
      // then check if we have already seen a submission from them in this
      // spreadsheet (the graded submissions are stored in an associative 
      // array in the graded worksheet object, where a unique "fingerprint" 
      // for each student is used as the key).
      
      var fingerprint = new_graded_subm.getSubmFingerprint();
      var existing_graded_subm = this.getGradedSubmissionByFingerprint(fingerprint);
      
      if (existing_graded_subm != null)
        {
          // This is a second (or third, ...) submission from a student.
          // If this submission is newer than the last one seen, replace it.
          var existing_timestamp = new Date(existing_graded_subm.getTimestamp());
          var new_timestamp = new Date(new_graded_subm.getTimestamp());
          var existing_times_submitted = existing_graded_subm.getTimesSubmitted();
          
          if (new_timestamp > existing_timestamp)
            {
              // record how many times until now this particular student submitted.
              new_graded_subm.setTimesSubmitted(existing_times_submitted);
              this.addGradedSubmission(fingerprint, new_graded_subm);
            }
   
          // whether we replaced an entry or not, we still want to increment
          // the number of submissions.
          existing_graded_subm = this.getGradedSubmissionByFingerprint(fingerprint);
          existing_graded_subm.setTimesSubmitted(existing_times_submitted + 1);
          this.addGradedSubmission(fingerprint, existing_graded_subm);
        }
      else
        {
          // This is the first time we've seen a submission from this student.
          // There's no need to compare submission timestamp.
          this.addGradedSubmission(fingerprint, new_graded_subm);
        }
    }    
} // GradesWorksheet.processSubmissionsSheet()

// processGradesSheet:
// Reads in all information in an existing 'Grades' sheet.
GradesWorksheet.prototype.processGradesSheet = function()
{
  Debug.info("GradesWorksheet.processGradesSheet()");
  
  Debug.assert(this.grades_sheet !== null, 
         "GradesWorksheet.processGradesSheet() - " +
           "no grades sheet");

  var numb_graded_submissions = this.getNumGradedSubmissions();

  // Read in the hidden row containing the grading_options.
  this.grading_options = this.getHiddenRow(GRADES_HIDDEN_ROW_TYPE_GRADING_OPT, 
                                           "",
                                           numb_graded_submissions);
  
  Debug.assert(this.grading_options[0] !== "", 
         "GradesWorksheet.processGradesSheet() - Can't find grading options");
  
  // Read in the hidden row containing the questions asked.
  var question_vals = this.getHiddenRow(GRADES_HIDDEN_ROW_TYPE_QUESTIONS_FULL, 
                                        "",
                                        numb_graded_submissions);
  
  // Read through the grading options to initialize variables like:
  //      points_possible, num_student_identifiers, and num_gradeable_questions
  this.processGradingOptions();
 
  // Pull in some info from the summary table at the top.
  
  var summary_range = this.grades_sheet.getRange(2, 2, gbl_num_summary_rows, 1);
  var summary_col = summary_range.getValues();
  this.avg_subm_score = summary_col[1];
  this.num_low = summary_col[3]; 

  var answer_key_vals = this.getHiddenRow(GRADES_HIDDEN_ROW_TYPE_ANSWER_KEY, 
                                          "", 
                                          numb_graded_submissions);
                                          
  var help_tips_vals = this.getHiddenRow(GRADES_HIDDEN_ROW_TYPE_HELP_TIPS,
                                         "",
                                         numb_graded_submissions);

  // Check if any help tips are present. They will be if there's at least one
  // non-empty cell in this row. otherwise the row will be entirely blank.
  
  var help_tips_present = false;
  var i;
  
  for (i = 0; i < help_tips_vals.length; i++)
    {
      if (help_tips_vals[i] != "")
        {
          help_tips_present = true;
          break;
        }
    }
  
  Debug.info("GradesWorksheet.processGradesSheet() - init_type: " + this.init_type);
  
  var max_submissions_to_read = 0;
  
  // TODO_AJR - add else.
  
  if (this.init_type == INIT_TYPE_GRADED_META)
    {
      // Just process a single submission so we can use it later to 
      // grab grading options, etc, but without needing to read and 
      // process *all* of the submissions. Used to construct the UI 
      // for emailing grades.
      max_submissions_to_read = 1;
    }
  else // INIT_TYPE_GRADED_FULL or INIT_TYPE_GRADED_PARTIAL
    {
      // Read in all graded submissions.
      max_submissions_to_read = this.getNumGradedSubmissions();      
    }
  
  Debug.info("GradesWorksheet.processGradesSheet() - max submissions: " + 
              max_submissions_to_read);
  
  // Read in and process graded submissions in the Grades sheet.
  var write_start_row = gbl_grades_start_row_num + 1;
             
  for (i = 0; i < max_submissions_to_read; i++)
    {
      // Create a new GradedSubmission from this graded submission.
      var new_graded_subm = new GradedSubmission(this, 
                                                 this.submissions_sheet, 
                                                 this.grades_sheet,
                                                 question_vals, 
                                                 help_tips_present, 
                                                 help_tips_vals,
                                                 this.grading_options, 
                                                 this.points_possible,
                                                 answer_key_vals, 
                                                 answer_key_vals,
                                                 this.num_student_identifiers,
                                                 write_start_row + i, 
                                                 this.init_type);
                      
      // Create a fingerprint to uniquely identify this student and store their submission.
      var fingerprint = new_graded_subm.getSubmFingerprint(); 
      this.addGradedSubmission(fingerprint, new_graded_subm);      
      Debug.info("GradesWorksheet.processGradesSheet() - new grade submission " + i);
      
    } // For each submission.
    
} // GradesWorksheet.processGradesSheet

// processGradingOptions()  
// Processes this.grading_options to record how many student identifiers there are, as well as
// how many points possible. Records these in this.points_possible and this.num_student_identifiers.
GradesWorksheet.prototype.processGradingOptions = function()
{  
  Debug.info("GradesWorksheet.processGradingOptions()");

  for (var q_index=0; q_index < this.grading_options.length; q_index++)
    {
      var gopt = this.grading_options[q_index];
      
      if (gopt === "")
        {
          continue; // blank from Grades sheet
        }
      
      if (gopt === GRADING_OPT_STUD_ID)
        {
          this.num_student_identifiers++;
        }
      else
        {
          this.num_gradeable_questions++;
          
          if (isWorthPoints(gopt))
            {
              this.points_possible += getPointsWorth(gopt);
            }
        }
    }
}

GradesWorksheet.prototype.prepNewGradesSheet = function()
{
  Debug.info("GradesWorksheet.prepNewGradesSheet()");

  // Start by creating the 'Grades' sheet. If it already exists, then
  // delete it (instructor was already warned before in Step 1).
  if (this.grades_sheet)
    {
      // Present, so delete it.
      this.spreadsheet.setActiveSheet(this.grades_sheet);
      this.spreadsheet.deleteActiveSheet();
        
      // To avoid a bug in which 'Grades' get deleted, but appears to
      // stick around, switch to another sheet after deleting it.
      // TODO_AJR: bug still exists sometimes.
      var switch_to_sheet = getSheetWithSubmissions(this.spreadsheet);
      this.spreadsheet.setActiveSheet(switch_to_sheet);  
    }
  
  // Next, create a blank sheet for the grades.
  this.grades_sheet = this.spreadsheet.insertSheet(langstr("FLB_STR_SHEETNAME_GRADES"));
    
  // Enter enough blank rows into the new Grades sheet. It
  // starts with 100, but we may need more. Not having enough
  // causes an error when trying to write to non-existent rows.
  var num_blank_rows_needed = gbl_grades_start_row_num + 1 
                              + (2 * this.submissions_sheet.getLastRow()) 
                              + gbl_num_space_before_hidden 
                              + gbl_num_hidden_rows 
                              + 10; // extra 10 for good measure
  
  if (num_blank_rows_needed > 100)
    {
      this.grades_sheet.insertRows(1, num_blank_rows_needed - 100);
    }
  
  // Write a simple message to the top-left cell, so users know
  // grades are being calculated.
  this.grades_sheet.getRange(1, 1, 1, 1)
                   .setValue(langstr("FLB_STR_GRADING_CELL_MESSAGE"))
                   .setFontWeight("bold");
  
} // GradesWorksheet.prepNewGradesSheet()

// writeGradesSheet:
// Write the graded submissions into the grades sheet. For the purposes 
// of performing the write the sheet is seperated into three areas:
// 
//   header - submissions summary
//   body - the submissions
//   footer - internal data, usually hidden
//
// already_emailed_info {array} - stored from gws this is replacing.
// student_feedback_info {array} -               "
// just_latest_submission {boolean} - whether to write all the submissions 
//   to the grades sheet, including the title, metrics, etc, or 
//   whether to just to fit the latest submission.

GradesWorksheet.prototype.writeGradesSheet = function(already_emailed_info, 
                                                      student_feedback_info,
                                                      just_latest_submission)
{ 
  // "Private" variables used in multiple functions nested in 'writeGradesSheet'.
  
  var first_graded_subm;
  var submissions_start_row;
  var next_footer_row;
  var total_subm_score = 0;
  var num_graded_subm_written = 0;
  
  var dp = PropertiesService.getDocumentProperties();
  
  // Store "this" object for use in the nested functions.
  var self = this;

  Debug.info("GradesWorksheet.writeGradesSheet()");
  Debug.info("GradesWorksheet.writeGradesSheet() - just writing latest?: " +  
              just_latest_submission);
  
  // Write the contents of the grade sheet.
  
  initializeWriting();
  writeHeader();
  writeFooter();
  writeBody();
  finalizeWriting();
  
  return;
  
  // Private functions.
       
  function initializeWriting()
  {
    Debug.assert(self.grades_sheet !== null, 
                 "GradesWorksheet.writeGradesSheet.initializeWriting() - " +
                   "no grades sheet");
  
    // Get the first graded submission from the grades sheet. This 
    // also initiaises the process of reading the submissions later on.
    first_graded_subm = self.getFirstGradedSubmission();
    
    // Add 1 to allow for the header.
    submissions_start_row = gbl_grades_start_row_num + 1;
    
    var exclude_latest = 0;
    
    if (just_latest_submission)
      {
        exclude_latest = 1;
        
        // Only the last submission will need writing so need to note the ones
        // already in the grades sheet, excluding this one which hasn't been 
        // written yet.
        num_graded_subm_written = parseInt(self.getNumGradedSubmissions() - 
                                           exclude_latest);   
      }
    
    Debug.info("GradesWorksheet.writeGradesSheet.initializeWriting() - " +
                "num_graded_subm_written: " + 
                num_graded_subm_written);

    // Calculate where the footer rows will start, add one for space between the 
    // submissions and the percentage value, take off one if we're just writing 
    // the latest submission as this will added later.
    next_footer_row = submissions_start_row + 
                      self.getNumGradedSubmissions() - 
                      exclude_latest +
                      1 + 
                      gbl_num_space_before_hidden; 
                      
    Debug.info("GradesWorksheet.writeGradesSheet.initializeWriting() - " + 
               "next_footer_row: " + 
               next_footer_row);
  
    // Hide the columns containing student feedback and the offset of this 
    // question stored in the footer.
    var metric_start_col = self.num_student_identifiers + 2;
    var feedback_col_num =  metric_start_col + METRIC_STUDENT_FEEDBACK;
    self.grades_sheet.hideColumns(feedback_col_num);
    var subm_copy_row_index_col_num =  metric_start_col + METRIC_SUBM_COPY_ROW_INDEX;
    self.grades_sheet.hideColumns(subm_copy_row_index_col_num);
    
    dp.setProperty(DOC_PROP_STUDENT_FEEDBACK_HIDDEN, "true"); 
    
  } // GradesWorksheet.writeGradesSheet.initializeWriting()

  // Nested function to write the grade sheet header.
  function writeHeader()
  {
    if (just_latest_submission)
      {
        // The header is already there.
        return;
      }
    
    // Create an area at the top of this sheet where the grades
    // summary will go after grading is done.
    setCellValue(self.grades_sheet, 1, 1, langstr("FLB_STR_GRADE_SUMMARY_TEXT_SUMMARY") + ":");
    self.grades_sheet.getRange(1, 1, 1, 1).setFontWeight("bold");
    setCellValue(self.grades_sheet, 2, 1, langstr("FLB_STR_GRADE_SUMMARY_TEXT_POINTS_POSSIBLE"));
    setCellValue(self.grades_sheet, 3, 1, langstr("FLB_STR_GRADE_SUMMARY_TEXT_AVERAGE_POINTS"));
    setCellValue(self.grades_sheet, 4, 1, langstr("FLB_STR_GRADE_SUMMARY_TEXT_COUNTED_SUBMISSIONS"));
    setCellValue(self.grades_sheet, 5, 1, langstr("FLB_STR_GRADE_SUMMARY_TEXT_NUM_LOW_SCORING"));
    
    var headers = first_graded_subm.createRowForGradesSheet(GRADES_OUTPUT_ROW_TYPE_QUESTIONS_HEADER);       
    
    writeArrayToRow(self.grades_sheet, gbl_grades_start_row_num, 1, headers, true, "");
    
    // turn on word wrap on the header rows.
	var wr = self.grades_sheet.getRange(1, 1, gbl_grades_start_row_num, headers.length);
    wr.setWrap(true);
    
  } // GradesWorksheet.writeGradesSheet.writeHeader()

  // Nested function to write the grade sheet footer.  
  function writeFooter()
  {
    // Write out some rows at the bottom of the grades sheet for internal
    // data processing. These include information like the grading options 
    // and the answer key values. This information is referenced later when 
    // doing things like emailing grades, creating reports, etc. It will 
    // usually be hidden from the user.
  
    if (!just_latest_submission)
      {
        writeArrayToRow(self.grades_sheet, 
                        next_footer_row++, 
                        1, 
                        first_graded_subm.createRowForGradesSheet(GRADES_OUTPUT_ROW_TYPE_GRADING_OPT), 
                        false, 
                        "");
        
        writeArrayToRow(self.grades_sheet, 
                        next_footer_row++, 
                        1, 
                        first_graded_subm.createRowForGradesSheet(GRADES_OUTPUT_ROW_TYPE_HELP_TIPS), 
                        false, 
                        "");
        
        writeArrayToRow(self.grades_sheet, 
                        next_footer_row++, 
                        1, 
                        first_graded_subm.createRowForGradesSheet(GRADES_OUTPUT_ROW_TYPE_ANSWER_KEY), 
                        false, 
                        "");
        
        writeArrayToRow(self.grades_sheet, 
                        next_footer_row++, 
                        1, 
                        first_graded_subm.createRowForGradesSheet(GRADES_OUTPUT_ROW_TYPE_QUESTIONS_FULL), 
                        false, 
                        "");
      }
    else
      {
        next_footer_row += gbl_num_hidden_rows;
      }  
      
  } // GradesWorksheet.writeGradesSheet.writeFooter()

  // Nested function to write the body of the grade sheet - the submissions themselves.
  function writeBody() 
  {  
    Debug.info("GradesWorksheet.writeGradesSheet.writeBody() - " + 
               "next_footer_row: " + 
               next_footer_row);
    
    self.grades_sheet.getRange("A1").activate();
    
    var gs_count = 1;
    var subm_score;
    var gs = first_graded_subm;
    var fingerprint;
    var write_submission = false;
    var num_graded_submissions = self.getNumGradedSubmissions();
    
    // Track number of submissions had that each possible number 
    // of points for its score. Init all to 0. Ranges from 0 to points_possible.
    var histogram_buckets = new Array(self.getPointsPossible() + 1);
    var histogram_len = histogram_buckets.length;
    while (--histogram_len >= 0)
      {
        histogram_buckets[histogram_len] = 0;
      }
    
    for (; gs != null; gs = self.getNextGradedSubmission(), gs_count++)
      { 
        // Initialise the write
        // --------------------
      
        if (already_emailed_info)
          {
            // Before writing out the grades, check if we already emailed 
            // this student before. If so, make a note of it so they don't 
            // get another email. If their number of submissions has 
            // changed since last time, we'll let them get emailed again.
            fingerprint = gs.getSubmFingerprint();
            
            if (fingerprint in already_emailed_info && 
                gs.getTimesSubmitted() === already_emailed_info[fingerprint]
                && !gs.getSubmissionEdited())
              {
                // No need to email their grade again.
                gs.setAlreadyEmailed();
              }
          }
      
        if (student_feedback_info)
          {
            fingerprint = gs.getSubmFingerprint();
            
            if (fingerprint in student_feedback_info) 
              {
                // Store the student's feedback.
                gs.setStudentFeedback(student_feedback_info[fingerprint]);
              }
           }
        
        // Record the offset into the hidden row section where a copy 
        // of the original submission is kept. Note that we store the location 
        // of the row rather than infer it in case the user sorts the Grades. Note. 
        // This needs to be done before writing to the grades sheet.
        gs.setSubmCopyRowIndex(gs_count - 1);
        
        // Write the submissions to the grades sheet
        // -----------------------------------------
        
        if (just_latest_submission)
          {
            if (gs_count === num_graded_submissions)
              {
                // When all of submissions get written to the grades sheet at                  
                // once space is allowed for them between the header and 
                // footer. However not if we're just writing the latest 
                // submission so a space needs to be made for it in the 
                // grades sheet.
                self.grades_sheet.insertRowsAfter(submissions_start_row + 
                                                  num_graded_subm_written, 
                                                  1);
              
                // Allow for the extra row that has been inserted pushing 
                // the footer down by a row.
                next_footer_row++;
            
                write_submission = true;
              }
          }
        else
          {
            // If not writing just the latest, must be writing all submissions.
            write_submission = true;
          }

        if (write_submission)
          {
            // Write the latest submission.
            writeGradedSubmission(gs, 
                                  submissions_start_row + 
                                    num_graded_subm_written++);
            
            // Write out the original full-text answer for each submission 
            // in the footer, adding an extra row if needed.
            writeArrayToRow(self.grades_sheet, 
                            next_footer_row,
                            1, 
                            gs.createRowForGradesSheet(GRADES_OUTPUT_ROW_TYPE_SUBMISSION_VALS), 
                            false, 
                            "");
            
            // We're in a loop so re-initialise this to false.
            write_submission = false;
          }

        // Finalize the writing
        // --------------------

        // Even though we may not have written a new footer entry, we need to 
        // move past the one that's there.
        next_footer_row++;
        
        // Keep a running tally of the submissions scores.
        subm_score = gs.getScorePoints();
        total_subm_score += subm_score;
        
        // Track the number of submissions that had this total score, 
        // for the histogram.
        histogram_buckets[subm_score] += 1;
        
      } // for all submissions
    
    // Record the url of the historgram chart.
    dp.setProperty(DOC_PROP_HISTOGRAM_URL, formHistogramURL(histogram_buckets));
    
    return;
    
    // Private Functions.
    
    // Write another row in the grades sheet.
    function writeGradedSubmission(graded_subm, write_row_num)
    {
      // Set the values and color of this row.
      
      var row_to_write = graded_subm.createRowForGradesSheet(GRADES_OUTPUT_ROW_TYPE_GRADED_VALS);
      
      var row_range = self.grades_sheet.getRange(write_row_num, 1, 1, row_to_write.length)
                                       .setValues([row_to_write]);
                                       
      Debug.assert(row_range !== null, "writeGradedSubmission() - write failed");
    
      var row_colors = [PALE_YELLOW, ""];
      var color = row_colors[num_graded_subm_written % 2];
      
      if (color)
        {
          row_range.setBackgroundColor(color);
        }
    
      // Highlight in red the names of students with low scores.
      var low_score = LOWSCORE_STUDENT_PERCENTAGE; // default
      var opt_low_score = dp.getProperty(DOC_PROP_ADV_OPTION_PASS_RATE);
      if (opt_low_score)
        {
          low_score = opt_low_score;
        }
      
      if (graded_subm.getScorePercent() < low_score)
        {
          self.grades_sheet.getRange(write_row_num, 
                                     2, 
                                     1, 
                                    self.num_student_identifiers + gbl_num_metrics_cols)
                           .setFontColor(PALE_RED);
        }
        
    } // writeGradedSubmission()
      
  } // GradesWorksheet.writeGradesSheet.writeBody()
  
  // Nested function to finalize the writing of the grade sheet.
  function finalizeWriting()
  {
    var fp_length;

    // Unless in debug mode, hide the footer rows.
    var num_hidden_rows = num_graded_subm_written + gbl_num_hidden_rows;
    var hide_start_row = next_footer_row - num_hidden_rows;
    self.grades_sheet.hideRows(hide_start_row, num_hidden_rows);

    // For each question, calculate the percent of students that got it correct
    // and write this to the grades sheet.
    self.num_low = writePercentages();
   
    // Put the number of graded submissions into persistent storage. 
    
    fp_length = self.fingerprint_list.length;
    
    Debug.assert(!!fp_length, 
                 "GradesWorksheet.writeGradesSheet.finalizeWriting() - " + 
                   "fingerprint list empty");
             
    NumGradedSubm.set(fp_length);
    
    // Calculate the new average score.
    self.avg_subm_score = floatToPrettyText(total_subm_score / 
                          self.getNumGradedSubmissions());
    
    // Update the summary of grades in the header.    
    setCellValue(self.grades_sheet, 2, 2, self.points_possible);
    setCellValue(self.grades_sheet, 3, 2, self.avg_subm_score);
    setCellValue(self.grades_sheet, 4, 2, self.getNumGradedSubmissions());
    setCellValue(self.grades_sheet, 5, 2, self.num_low);
    
    // Also record number of student identifiers as a property, since we need to 
    // know it when generating the Flubaroo menu.
    dp.setProperty(DOC_PROP_NUM_STUDENT_IDENTIFIERS, 
                                 self.num_student_identifiers);
    
    // For ease of reading, freeze top rows and student id columns (that's 
    // a lot of flushing, but seems to be the only way to get it to work.
    SpreadsheetApp.flush();    
    self.grades_sheet.setFrozenRows(gbl_grades_start_row_num);
    SpreadsheetApp.flush();
    self.grades_sheet.setFrozenColumns(1 + self.num_student_identifiers);        
    SpreadsheetApp.flush();
    
    // Keep track (anonymously) of number of assignments manually 
    // graded using Flubaroo, as well as active monthly users.
    logActiveUserGrading();
    if (!Autograde.isOn())
      {
        logGrading(self.spreadsheet.getName()); 
      }
    
    return;
    
    // Private Functions.
    
    // TODO_AJR - GetNumGradedSubmissions() is called a lot in here, could
    // we pass it in.
    
    // Nested function to write the percentage values to the 
    // grades sheet.
    function writePercentages()
    {
      // Add a row with the percent of the class that got each 
      // question correct. 
      var perc_correct = [];
      var num_low = 0;    
        
      // Calculate the percentages.
      num_low = calculatePercentages();
      
      // Write the percentages to the grades sheet.
      writePercentages2();
      
      return num_low;
      
      // Private Functions.

      function calculatePercentages()
      {
        // Init the perc_correct array. For each question this gives the percent
        // of students that got each question correct. Take the total number of points 
        // achieved for a particular question, divide that by the number of points
        // possible for a question, times that by the number of submissions and 
        //
        // Percentage for each question = 
        //    (sum of points achieved on the questions) /
        //    (total number of points possible) * 
        //    100
        
        var gopt;
        var gval;
        var perc_correct_index;
        var first_pass = true;
        var gs;
        var q;
        
        // Do a first pass through the questions for each submission
        // and record the number of correct answers for each question.
        
        for (gs = self.getFirstGradedSubmission(); 
             gs != null; 
             gs = self.getNextGradedSubmission())
          {
            perc_correct_index = 0;
          
            for (q = gs.getFirstQuestion(); q != null; q = gs.getNextQuestion(q))
              {
                gopt = q.getGradingOption();
              
                if (isStudentIdentifier(gopt) || q.isTimestamp())
                  { 
                    // There will be no percent correct metric for 
                    // student identifiers (e.g. name, email). Also 
                    // none for the timestamp, so skip that one as well.
                    continue;
                  }
                
                // Initialize perc_correct array. The final length will 
                // be number of gradeable questions excluding the 
                // timestamp.
                if (first_pass)
                  {
                    if (isWorthPoints(gopt)) 
                      {
                        perc_correct.push(0.00);
                      }
                    else
                      {
                        // Either timestamp or question for which 
                        // grading was skipped so no percentage assigned.
                        perc_correct.push(-1);
                      }
                  }
                
                if (isWorthPoints(gopt) && q.getGradedVal() > 0)
                  {
                    // Question was answered correctly! record another correct answer.
                    perc_correct[perc_correct_index]++;
                  }
                
                perc_correct_index++;
                
              } // For each question.
            
            first_pass = false;
            
        } // For each submission.
        
        // Now do a pass through the perc_correct array again and for 
        // each question worth points convert the number of 
        // students who got it right to a percent of students.
        
        var num_low = 0;
        var num_submissions = self.getNumGradedSubmissions();
        
        for (var i = 0; i < perc_correct.length; i++)
          {
            if (perc_correct[i] != -1)
              {
                perc_correct[i] = 100 * 
                                  perc_correct[i] / 
                                  num_submissions;
            
                perc_correct[i] = floatToPrettyText(perc_correct[i]);
            
                var perc = perc_correct[i];
            
                if (!isNaN(perc) && perc < LOWSCORE_QUESION_PERCENTAGE)
                  {
                    num_low++;
                  }
              }
            else
              {
                // No applicable percentage so just put blank.
                perc_correct[i] = "";
              }
          }
          
        return num_low;
        
      } // GradesWorksheet.writeGradesSheet.finalizeWriting.writePercentages.calculatePercentages()
    
      function writePercentages2() 
      {
        // First calculate the percentages and write them into
        // the perc_correct array.
        
        // First row into which to write grades
        var write_start_row = gbl_grades_start_row_num + 1; 
        
        // Add a space after the submissions (the '1').
        var percent_correct_row = write_start_row + 
                                  self.getNumGradedSubmissions() + 
                                  1;
        
        // First '1' is for timestamp.
        var percent_correct_start_col = 1 + 
                                        self.num_student_identifiers + 
                                        gbl_num_metrics_cols + 
                                        1; 
        
        if (just_latest_submission)
          {      
            var delete_range = self.grades_sheet.getRange(percent_correct_row - 1, 
                                                          percent_correct_start_col, 
                                                          1, 
                                                          perc_correct.length);
            
            // A single row has been added for the new submission so 
            // delete the old percentage values in the row above.
            delete_range.setValue("");
          }
        
        // Write in the percentage values.
        var row_range = self.grades_sheet.getRange(percent_correct_row, 
                                                   percent_correct_start_col, 
                                                   1, 
                                                   perc_correct.length);
        
        row_range.setValues([perc_correct]);
        
        // Set the percentage value and the question name background to orange.
        var low_avg_score_color = "orange";
        
        for (var q_index = 0; q_index < perc_correct.length; q_index++)
          {
            var perc = parseFloat(perc_correct[q_index]);
            var c_index = percent_correct_start_col + q_index;
            
            if (!isNaN(perc) && perc < LOWSCORE_QUESION_PERCENTAGE)
              {        
                setCellColor(self.grades_sheet, 
                             gbl_grades_start_row_num, 
                             c_index, 
                             low_avg_score_color);
                
                setCellColor(self.grades_sheet, 
                             percent_correct_row, 
                             c_index, 
                             low_avg_score_color);
              }
            
          } // For each array element.
        
      } // GradesWorksheet.writeGradesSheet.finalizeWriting.writePercentages.writePercentages2()

    } // GradesWorksheet.writeGradesSheet.finalizeWriting.writePercentages()
        
  } // GradesWorksheet.writeGradesSheet.finalizeWriting()

} // GradesWorksheet.writeGradesSheet()

GradesWorksheet.prototype.getHiddenRow = function(hidden_row_id, 
                                                  opt_graded_subm_row_index,
                                                  numb_graded_submissions)
{
  Debug.info("GradesWorksheet.getHiddenRow() - " + 
             "row_id: " + hidden_row_id + " " +
             "subm row index: " + opt_graded_subm_row_index +
             "numb_graded_submissions: " + numb_graded_submissions);

  // First row into which grades were written.
  var write_start_row = gbl_grades_start_row_num + 1; 
 
  // Where the percentages are in the grades sheet. 
  var percent_correct_row = write_start_row + 
                            numb_graded_submissions + 
                            1;
  
  // Where the hidden rows start.
  var hidden_row_num_start = percent_correct_row + 
                             gbl_num_space_before_hidden;

  var n = 0;

  if (opt_graded_subm_row_index)
    {
      // An offset past the first hidden row.
      n += opt_graded_subm_row_index; 
    }

  var row_num = hidden_row_num_start + hidden_row_id + n;

  Debug.info("GradesWorksheet.getHiddenRow() - row_num: " + row_num);

  var hidden_row = singleRowToArray(this.grades_sheet, 
                                    hidden_row_num_start + hidden_row_id + n, 
                                    -1);

  return hidden_row;
}

// TODO_AJR - Looking at the log, the last submission in the grades sheet is coming 
// back false on getAlreadyEmailed() it's missing from the log.

// getAlreadyEmailedInfo:
// Note: Only for use when the init_type is INIT_TYPE_GRADED_PARTIAL or INIT_TYPE_GRADED_FULL.
// Returns an associative array, indexed by fingerprints, which contains the number
// of times a student has submitted the assignment. Only submissions for which an email has 
// already been sent will have an entry. 
GradesWorksheet.prototype.getAlreadyEmailedInfo = function()
{
  var already_emailed = [];
  var gs;
  var count;
  
  for (gs = this.getFirstGradedSubmission(), count = 0; 
       gs != null; 
       gs = this.getNextGradedSubmission())
    {
      if (gs.getAlreadyEmailed())
        {
          already_emailed[gs.getSubmFingerprint()] = gs.getTimesSubmitted();
          
          Debug.info("GradesWorksheet.getAlreadyEmailedInfo() fp: " + 
                     gs.getSubmFingerprint() +
                     " already emailed: " + 
                     already_emailed[gs.getSubmFingerprint()]);
          count++;
        }
    }

  Debug.info("GradesWorksheet.getAlreadyEmailedInfo(): count: " + count); 

  return already_emailed;
}

// getStudentFeedbackInfo:
// Note: Only for use when the init_type is INIT_TYPE_GRADED_PARTIAL or INIT_TYPE_GRADED_FULL.
// Returns an associative array, indexed by fingerprints, which contains the optional
// feedback entered by an instructor for a given student. If none, no fingerprint for that 
// student will exist.
GradesWorksheet.prototype.getStudentFeedbackInfo = function()
{
  var student_feedback = [];
  var gs;
  var feedback;
  
  for (gs = this.getFirstGradedSubmission(); 
       gs != null; 
       gs = this.getNextGradedSubmission())
    {
      feedback = gs.getStudentFeedback();
    
      if (feedback != "")
        {
          student_feedback[gs.getSubmFingerprint()] = feedback;
        }
    }
  
  return student_feedback;
}