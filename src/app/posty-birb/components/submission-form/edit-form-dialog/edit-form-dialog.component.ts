import { Component, forwardRef, OnInit, AfterViewInit, AfterViewChecked, OnChanges, SimpleChanges, Input, Output, EventEmitter, Inject, OnDestroy, ViewChild, ViewChildren, QueryList } from '@angular/core';
import { FormGroup, FormBuilder, Validators, AbstractControl } from '@angular/forms';
import { Subscription } from 'rxjs/Subscription';

import { MatDialogRef, MatDialog } from '@angular/material';
import { SaveEditDialogComponent } from '../save-edit-dialog/save-edit-dialog.component';
import { CreateTemplateDialogComponent } from '../../dialog/create-template-dialog/create-template-dialog.component';
import { SubmissionRuleHelpDialogComponent } from '../../dialog/submission-rule-help-dialog/submission-rule-help-dialog.component';

import { PostyBirbSubmission } from '../../../../commons/models/posty-birb/posty-birb-submission';
import { WebsiteManagerService } from '../../../../commons/services/website-manager/website-manager.service';
import { SupportedWebsites } from '../../../../commons/enums/supported-websites';
import { WebsiteStatus } from '../../../../commons/enums/website-status.enum';

import { BaseWebsiteFormComponent } from '../base-website-form/base-website-form.component';

//Not a dialog anymore
@Component({
  selector: 'edit-form-dialog',
  templateUrl: './edit-form-dialog.component.html',
  styleUrls: ['./edit-form-dialog.component.css']
})
export class EditFormDialogComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges, AfterViewChecked {
  @Output() readonly onSave: EventEmitter<any> = new EventEmitter();

  @Input() selectedSubmissions: PostyBirbSubmission[] = [];

  @ViewChild('templateSelect') templateSelect: any;
  @ViewChild('submissionSelect') submissionSelect: any;
  @ViewChildren(BaseWebsiteFormComponent) private websiteForms: QueryList<BaseWebsiteFormComponent>;

  private subscription: Subscription = Subscription.EMPTY;

  public form: FormGroup;
  public defaultDescription: any;
  public defaultTags: any;
  public supportedWebsites: any = SupportedWebsites;
  public onlineWebsites: string[] = [];
  public offlineWebsites: string[] = [];
  public unloadedTemplate: any;

  constructor(private managerService: WebsiteManagerService, private fb: FormBuilder, private dialog: MatDialog) {
    this.form = this.fb.group({
      defaultDescription: [],
      defaultTags: [],
      selectedWebsites: [[], [Validators.required, Validators.minLength(1)]]
    });
  }

  ngOnInit() {
    this.form.controls.defaultDescription.valueChanges.subscribe(value => this.defaultDescription = value);
    this.form.controls.defaultTags.valueChanges.subscribe(value => this.defaultTags = value);
    this.form.controls.selectedWebsites.valueChanges.subscribe(() => this.formsAreValid());

    this.updateOnlineWebsites(this.managerService.getWebsiteStatuses());
    this.subscription = this.managerService.getObserver().subscribe(statuses => this.updateOnlineWebsites(statuses));

    this.fillFromSingleSubmission();

  }

  ngAfterViewInit() {
    this.fillFromSingleSubmission();
  }

  ngAfterViewChecked() {
    if (this.unloadedTemplate) { // Load a selected template in for website forms that hadn't been loaded in yet
      this.websiteForms.forEach(form => form.writeValue(this.unloadedTemplate[form.website]));
      this.unloadedTemplate = null;
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes) {
      if (changes.selectedSubmissions) {
        this.selectedSubmissions = changes.selectedSubmissions.currentValue || [];
        this.fillFromSingleSubmission();
      }
    }
  }

  ngOnDestroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }

  private fillFromSingleSubmission(): void {
    if (this.selectedSubmissions.length === 1) { // only one to edit
      const submission: PostyBirbSubmission = this.selectedSubmissions[0];
      this.form.patchValue(submission.getDefaultFields());
      if (this.websiteForms) this.websiteForms.forEach(form => form.writeValue(submission.getWebsiteFieldFor(form.website)))
    }
  }

  public websitesSelected(): boolean {
    return (this.form.value.selectedWebsites || []).length > 0;
  }

  public showHelp(): void {
    const dialogRef: MatDialogRef<SubmissionRuleHelpDialogComponent> = this.dialog.open(SubmissionRuleHelpDialogComponent);
  }

  public save(): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.formsAreValid()) {
        reject(false);
        alert('Edits must be valid to save!');
        return;
      }

      if (this.selectedSubmissions.length === 1) { // Skip dialog when only one to edit
        this.markUntouched();
        const submission: PostyBirbSubmission = this.selectedSubmissions[0];
        submission.setWebsiteFields(this.generateWebsiteValuesObject());
        submission.setDefaultFields(this.form.value);
        submission.setUnpostedWebsites(this.form.value.selectedWebsites);

        this.onSave.emit(true);
        resolve(true);
      } else {
        let dialogRef = this.dialog.open(SaveEditDialogComponent, {
          data: this.selectedSubmissions
        });

        dialogRef.afterClosed().subscribe(selected => {
          if (selected) {
            selected.forEach(submission => {
              submission.setWebsiteFields(this.generateWebsiteValuesObject());
              submission.setDefaultFields(this.form.value);
              submission.setUnpostedWebsites(this.form.value.selectedWebsites);
            });

            this.markUntouched();
            this.onSave.emit(true);
          }

          resolve(true);
        });
      }
    });
  }

  public saveTemplate(): void {
    let dialogRef: MatDialogRef<CreateTemplateDialogComponent>;
    dialogRef = this.dialog.open(CreateTemplateDialogComponent);

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.templateSelect.addTemplate(result, { default: this.form.value, website: this.generateWebsiteValuesObject() });
      }
    });
  }

  public templateSelected(profile: any): void {
    this.form.setValue(profile.config.default);
    this.unloadedTemplate = profile.config.website;
  }

  public loadFromSubmission(event: any): void {
    const submission: PostyBirbSubmission = event.value;
    this.form.patchValue(submission.getDefaultFields());
    this.websiteForms.forEach(form => form.writeValue(submission.getWebsiteFieldFor(form.website)));
  }

  public clear(): void {
    this.form.reset();
    this.websiteForms.forEach(form => form.clear());
    this.templateSelect.reset();
    // HACK: Probably not the best way to clear
    if (this.submissionSelect) this.submissionSelect.writeValue(undefined);
  }

  private markUntouched(): void {
    this.form.markAsUntouched();
    this.form.markAsPristine();
  }

  private updateOnlineWebsites(statuses: any[]): void {
    let onlineInserted: boolean = false;
    let offlineInserted: boolean = false;

    Object.keys(statuses).forEach(website => {
      if (statuses[website] === WebsiteStatus.Logged_In) { // Add to Online, remove from Offline
        const index = this.offlineWebsites.indexOf(website);
        if (index !== -1) {
          this.offlineWebsites.splice(index, 1);
        }

        if (!this.onlineWebsites.includes(website)) {
          this.onlineWebsites.push(website);
          onlineInserted = true;
        }
      } else { // Remove from Online, add to Offline
        const index = this.onlineWebsites.indexOf(website);
        if (index !== -1) {
          this.onlineWebsites.splice(index, 1);
        }

        if (!this.offlineWebsites.includes(website)) {
          this.offlineWebsites.push(website);
          offlineInserted = true;
        }
      }
    });

    if (onlineInserted) this.onlineWebsites.sort();
    if (offlineInserted) this.offlineWebsites.sort();
  }

  private buildWebsiteFormObject(): any {
    const obj: any = {};

    Object.keys(SupportedWebsites).forEach(website => {
      obj[SupportedWebsites[website]] = [];
    });

    return obj;
  }

  public formsAreValid(): boolean {
    if (!this.websiteForms) return;

    const keys = this.form.value.selectedWebsites || [];
    for (let i = 0; i < keys.length; i++) {
      const website = keys[i];
      let valid: boolean = true;

      this.websiteForms.forEach(form => {
        if (form.website === website && !form.isValid()) {
          valid = false
        }
      });

      return valid;
    }

    return keys.length > 0 ? true : false;
  }

  public hasPendingChanges(): boolean {
    if (!this.form.pristine) return true;

    let hasPending: boolean = false;
    this.websiteForms.forEach(form => {
      if (!form.isPristine()) {
        hasPending = true;
      }
    });

    return hasPending;
  }

  public generateWebsiteValuesObject(): any {
    const keys = this.form.value.selectedWebsites || [];

    const vals: any = {};
    this.websiteForms.forEach(form => {
      if (keys.includes(form.website)) {
        vals[form.website] = form.getValues();
      } else {
        vals[form.website] = null;
      }
    });

    return vals;
  }

}